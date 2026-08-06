import { calculateTotals } from "../domain/field";
import type {
  CustomEffect,
  FieldState,
  RelevantTotalKey,
  SupportStatus,
  Zone,
} from "../domain/types";
import type {
  AmbientEntityReference,
  AmbientIntent,
  AmbientIntentKind,
} from "../echo/ambientEventTypes";
import { serializeStable } from "../utils/stableSerialization";
import {
  createAthenaAwarenessContext,
  rankAthenaAuthoritySource,
} from "./foundation";
import {
  ATHENA_CONTEXT_VERSION,
  type AthenaAuthorityPrecedence,
  type AthenaAuthoritySource,
  type AthenaAwarenessContext,
  type AthenaBattlefieldObject,
  type AthenaSupportFindingStatus,
} from "./types";
import {
  ATHENA_DEPENDENCY_GRAPH_CACHE_VERSION,
  ATHENA_DEPENDENCY_GRAPH_VERSION,
  type AthenaDependencyGraph,
  type AthenaEchoDependencyQueryResult,
  type AthenaEventCategory,
  type AthenaGraphBuildOptions,
  type AthenaGraphBuildReason,
  type AthenaGraphChange,
  type AthenaGraphDiagnostics,
  type AthenaGraphDisabledReason,
  type AthenaGraphIndexes,
  type AthenaGraphInvalidationResult,
  type AthenaGraphNode,
  type AthenaGraphNodeType,
  type AthenaGraphQueryApi,
  type AthenaGraphRelationship,
  type AthenaGraphRelationshipType,
  type AthenaGraphUpdateResult,
} from "./dependencyGraphTypes";

const GRAPH_NODE_TYPES: AthenaGraphNodeType[] = [
  "battlefield-object",
  "player-state",
  "relevant-total",
  "zone",
  "event-category",
  "effect-definition",
  "token-definition",
  "counter-definition",
  "authority-marker",
];

const GRAPH_RELATIONSHIP_TYPES: AthenaGraphRelationshipType[] = [
  "observes",
  "modifies",
  "reads",
  "contributes-to",
  "affects",
  "creates",
  "places-counters-on",
  "attached-to",
  "derived-from",
  "controls",
  "owns",
  "invalidates",
  "requires-choice",
  "requires-authority",
];

const EVENT_CATEGORIES: AthenaEventCategory[] = [
  "permanent-entered",
  "creature-entered",
  "token-created",
  "token-entered",
  "land-entered",
  "counter-placed",
  "counter-removed",
  "life-gained",
  "life-lost",
  "damage-dealt",
  "combat-damage",
  "permanent-died",
  "permanent-sacrificed",
  "permanent-exiled",
  "permanent-returned-to-hand",
  "permanent-returned-to-battlefield",
  "permanent-transformed",
  "permanent-tapped",
  "permanent-untapped",
  "spell-cast",
  "attack-declared",
  "combat-completed",
  "token-removed",
  "zone-changed",
  "trigger-announced",
  "reminder-created",
  "battlefield-note-created",
];

const ZONES: Zone[] = [
  "battlefield",
  "hand",
  "graveyard",
  "exile",
  "library",
  "command",
];

type DefinitionTarget =
  | "self"
  | "creatures"
  | "battlefield"
  | "players"
  | "none";

interface GraphDefinition {
  id: string;
  label: string;
  effectKind: string;
  sourceGroupId: string | null;
  sourceObjectIds: string[];
  observes: AthenaEventCategory[];
  modifies: AthenaEventCategory[];
  reads: RelevantTotalKey[];
  affects: DefinitionTarget;
  creates: TokenDefinition[];
  counters: CounterDefinition[];
  supportStatus: SupportStatus | null;
  support: AthenaSupportFindingStatus;
  authoritySource: AthenaAuthoritySource;
  enabled: boolean;
  disabledReason: AthenaGraphDisabledReason;
  requiresAuthority: boolean;
  requiresManualResolution: boolean;
  metadata: Record<string, string | number | boolean | null>;
}

interface TokenDefinition {
  id: string;
  name: string;
  power: number | null;
  toughness: number | null;
  cardTypes: string[];
  subtypes: string[];
}

interface CounterDefinition {
  id: string;
  name: string;
  target: DefinitionTarget;
}

interface GraphBuilderState {
  context: AthenaAwarenessContext;
  field: FieldState | null;
  timestamp: string;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  nodes: Map<string, AthenaGraphNode>;
  relationships: Map<string, AthenaGraphRelationship>;
  staleReferences: Set<string>;
}

export function buildAthenaDependencyGraph(
  field: FieldState,
  options: AthenaGraphBuildOptions = {},
): AthenaDependencyGraph {
  const context = createAthenaAwarenessContext(field, {
    timestamp: options.timestamp,
    authoritySource: options.authoritySource,
    maxRelationships: options.maxRelationships,
  });
  return buildAthenaDependencyGraphFromContext(context, {
    ...options,
    field,
  });
}

export function buildAthenaDependencyGraphFromContext(
  context: AthenaAwarenessContext,
  options: AthenaGraphBuildOptions & { field?: FieldState | null } = {},
): AthenaDependencyGraph {
  const started = performanceNow();
  const authoritySource =
    options.authoritySource ?? context.currentAuthoritySource;
  const builder: GraphBuilderState = {
    context,
    field: options.field ?? null,
    timestamp: options.timestamp ?? context.createdAt,
    authoritySource,
    authorityPrecedence: rankAthenaAuthoritySource(authoritySource),
    nodes: new Map(),
    relationships: new Map(),
    staleReferences: new Set(),
  };

  addBaselineNodes(builder);
  addBattlefieldObjectNodes(builder);
  addPlayerNodes(builder);
  addRelevantTotalNodes(builder);
  addZoneNodes(builder);
  addEventCategoryNodes(builder);
  addObjectRelationships(builder);
  addDefinitionRelationships(builder);
  addCustomEffectRelationships(builder);
  addInvalidationRelationships(builder);

  const nodes = sortNodes([...builder.nodes.values()]);
  const relationships = sortRelationships([...builder.relationships.values()]);
  const indexes = buildIndexes(nodes, relationships);
  const cycleCount = detectRelationshipCycles(nodes, relationships).length;
  const fullRebuildDurationMs = performanceNow() - started;
  const graph: AthenaDependencyGraph = {
    version: ATHENA_DEPENDENCY_GRAPH_VERSION,
    cacheVersion: ATHENA_DEPENDENCY_GRAPH_CACHE_VERSION,
    fieldId: context.fieldId,
    sessionId: context.sessionId,
    contextVersion: context.version,
    createdAt: builder.timestamp,
    authoritySource,
    authorityPrecedence: builder.authorityPrecedence,
    fingerprint: fingerprintGraphInput(context, options.field ?? null),
    nodes,
    relationships,
    indexes,
    diagnostics: createGraphDiagnostics({
      nodes,
      relationships,
      fullRebuildDurationMs,
      incrementalUpdateDurationMs: 0,
      staleReferenceCount: builder.staleReferences.size,
      cycleCount,
      lastRebuildReason: options.reason ?? "full-rebuild",
      lastInvalidationSet: [],
      lastError: null,
    }),
    committedStateReadOnly: true,
    derivedFromCanonicalState: true,
    directBattlefieldMutation: false,
    duplicateBattlefieldState: false,
    duplicateEventHistory: false,
    duplicateUndoStack: false,
  };
  return graph;
}

export function updateAthenaDependencyGraph(
  previous: AthenaDependencyGraph,
  field: FieldState,
  change: AthenaGraphChange,
  options: AthenaGraphBuildOptions = {},
): AthenaGraphUpdateResult {
  const started = performanceNow();
  const invalidation = invalidateAthenaDependencyGraph(previous, change);
  const graph = buildAthenaDependencyGraph(field, {
    ...options,
    reason: "incremental-update",
  });
  const full = buildAthenaDependencyGraph(field, {
    ...options,
    reason: "full-rebuild",
  });
  const incrementalUpdateDurationMs = performanceNow() - started;
  return {
    graph: {
      ...graph,
      diagnostics: {
        ...graph.diagnostics,
        incrementalUpdateDurationMs,
        lastInvalidationSet: invalidation.affectedNodeIds,
      },
    },
    invalidation,
    equivalentToFullRebuild:
      graphIdentity(graph) === graphIdentity(full) &&
      previous.version === ATHENA_DEPENDENCY_GRAPH_VERSION,
  };
}

export function invalidateAthenaDependencyGraph(
  graph: AthenaDependencyGraph,
  change: AthenaGraphChange,
): AthenaGraphInvalidationResult {
  const started = performanceNow();
  const changedNodeIds = resolveChangedNodeIds(graph, change);
  const relationshipIds = new Set<string>();
  const affectedNodeIds = new Set<string>();
  const staleReferenceIds = new Set<string>();
  const queue = [...changedNodeIds];
  const visited = new Set<string>(changedNodeIds);
  const reasons = new Set<string>();

  if (change.reason) reasons.add(change.reason);
  reasons.add(`Graph change: ${change.kind}.`);

  for (const nodeId of changedNodeIds) affectedNodeIds.add(nodeId);

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) continue;
    const outgoing = graph.indexes.relationshipsBySource[nodeId] ?? [];
    const incoming = graph.indexes.relationshipsByTarget[nodeId] ?? [];
    for (const relationshipId of [...outgoing, ...incoming]) {
      relationshipIds.add(relationshipId);
      const relationship = relationshipById(graph, relationshipId);
      if (!relationship) {
        staleReferenceIds.add(relationshipId);
        continue;
      }
      const nextIds = [
        relationship.from,
        relationship.to,
        ...relationship.invalidatesNodeIds,
      ];
      for (const nextId of nextIds) {
        if (!graph.nodes.some((node) => node.id === nextId)) {
          staleReferenceIds.add(nextId);
          continue;
        }
        affectedNodeIds.add(nextId);
        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push(nextId);
        }
      }
      if (!relationship.enabled) {
        reasons.add(
          `Disabled relationship boundary: ${relationship.disabledReason}.`,
        );
      }
    }
  }

  const previewInvalidated =
    change.kind === "card-removed" ||
    change.kind === "tracking-toggled" ||
    change.kind === "depower-changed" ||
    change.kind === "transformed" ||
    change.kind === "stack-split" ||
    change.kind === "stack-merge" ||
    change.kind === "authority-result-received" ||
    change.kind === "undo" ||
    change.kind === "redo" ||
    relationshipIds.size > 0;

  return {
    changedNodeIds: sortStrings(changedNodeIds),
    affectedNodeIds: sortStrings([...affectedNodeIds]),
    relationshipIds: sortStrings([...relationshipIds]),
    previewInvalidated,
    reasons: sortStrings([...reasons]),
    staleReferenceIds: sortStrings([...staleReferenceIds]),
    durationMs: performanceNow() - started,
    directBattlefieldMutation: false,
  };
}

export function createAthenaGraphQueryApi(
  graph: AthenaDependencyGraph,
): AthenaGraphQueryApi {
  return {
    getNode: (id) => nodeById(graph, id),
    getRelationship: (id) => relationshipById(graph, id),
    getObserversForEvent: (eventCategory) =>
      relationshipsFromIndex(
        graph,
        graph.indexes.observersByEvent[eventCategory],
      ),
    getModifiersForEvent: (eventCategory) =>
      relationshipsFromIndex(
        graph,
        graph.indexes.modifiersByEvent[eventCategory],
      ),
    getStaticReadersForTotal: (total) =>
      relationshipsFromIndex(graph, graph.indexes.readersByTotal[total]),
    getContributorsToTotal: (total) =>
      relationshipsFromIndex(graph, graph.indexes.contributorsByTotal[total]),
    getEffectsAffectingObject: (groupId) =>
      relationshipsForObject(graph, groupId).filter(
        (relationship) => relationship.type === "affects",
      ),
    getTargetsAffectedBySource: (groupId) =>
      relationshipsForObject(graph, groupId).filter(
        (relationship) => relationship.sourceGroupId === groupId,
      ),
    getTokenDefinitionsCreatedBySource: (groupId) =>
      relationshipsForObject(graph, groupId).filter(
        (relationship) => relationship.type === "creates",
      ),
    getCounterRelationshipsFromSource: (groupId) =>
      relationshipsForObject(graph, groupId).filter(
        (relationship) => relationship.type === "places-counters-on",
      ),
    getAttachmentsForObject: (groupId) =>
      relationshipsFromIndex(
        graph,
        graph.indexes.attachmentsByHost[objectNodeId(groupId)],
      ),
    getDependentNodes: (nodeId) =>
      invalidateAthenaDependencyGraph(graph, {
        kind: "preview-invalidation",
        nodeIds: [nodeId],
      })
        .affectedNodeIds.map((id) => nodeById(graph, id))
        .filter((node): node is AthenaGraphNode => Boolean(node)),
    getInvalidationForChange: (change) =>
      invalidateAthenaDependencyGraph(graph, change),
    getRelationshipsDisabledByTracking: () =>
      graph.relationships.filter(
        (relationship) => relationship.disabledReason === "not-tracked",
      ),
    getRelationshipsDisabledByDepower: () =>
      graph.relationships.filter(
        (relationship) => relationship.disabledReason === "depowered",
      ),
    getUnsupportedRelationships: () =>
      relationshipsFromIndex(graph, graph.indexes.unsupportedRelationshipIds),
    getAuthorityRequiredRelationships: () =>
      relationshipsFromIndex(
        graph,
        graph.indexes.authorityRequiredRelationshipIds,
      ),
    getRelationshipsForObject: (groupId) =>
      relationshipsForObject(graph, groupId),
    getRelationshipsForEventSource: (sourceId) =>
      graph.relationships.filter(
        (relationship) =>
          relationship.sourceGroupId === sourceId ||
          relationship.sourceObjectIds.includes(sourceId) ||
          relationship.id.includes(sourceId),
      ),
    getDependenciesForEchoIntent: (intent) =>
      dependenciesForEchoIntent(graph, intent),
  };
}

export function detectAthenaGraphCycles(
  graph: AthenaDependencyGraph,
): string[][] {
  return detectRelationshipCycles(graph.nodes, graph.relationships);
}

function addBaselineNodes(builder: GraphBuilderState): void {
  addNode(builder, {
    id: authorityNodeId("boardstate-authority"),
    type: "authority-marker",
    label: "BoardState authority boundary",
    groupId: null,
    objectIds: [],
    relevantTotal: null,
    zone: null,
    eventCategory: null,
    effectKind: "authority",
    quantity: 1,
    supportStatus: null,
    support: null,
    enabled: false,
    disabledReason: "authority-required",
    metadata: {
      productionVisible: false,
      connected: false,
      precedence: 1,
    },
  });
  addNode(builder, {
    id: authorityNodeId("unsupported"),
    type: "authority-marker",
    label: "Unsupported or manual resolution boundary",
    groupId: null,
    objectIds: [],
    relevantTotal: null,
    zone: null,
    eventCategory: null,
    effectKind: "support-boundary",
    quantity: 1,
    supportStatus: "unsupported",
    support: "unsupported-effect",
    enabled: false,
    disabledReason: "support-boundary",
    metadata: {
      productionVisible: false,
      requiresManualResolution: true,
    },
  });
}

function addBattlefieldObjectNodes(builder: GraphBuilderState): void {
  for (const object of builder.context.battlefield) {
    addNode(builder, {
      id: objectNodeId(object.groupId),
      type: "battlefield-object",
      label: object.label,
      groupId: object.groupId,
      objectIds: object.objectIds,
      relevantTotal: null,
      zone: object.zone,
      eventCategory: null,
      effectKind: null,
      quantity: object.quantity,
      supportStatus: object.supportStatus,
      support: supportForStatus(object.supportStatus, object.isGeneric),
      enabled: object.zone === "battlefield",
      disabledReason:
        object.zone === "battlefield" ? "none" : "zone-not-battlefield",
      metadata: {
        isGeneric: object.isGeneric,
        isToken: object.isToken,
        isCommander: object.isCommander,
        isCreature: object.isCreature,
        trackingEnabled: object.trackingEnabled,
        abilitiesActive: object.abilitiesActive,
        depowerMode: object.depowerMode,
        stackKey: object.stackKey,
        sourceUnavailableReason: object.sourceUnavailableReason ?? "none",
      },
    });
  }
}

function addPlayerNodes(builder: GraphBuilderState): void {
  const player = builder.field?.player;
  const playerNodes: Array<{ id: string; label: string; quantity: number }> = [
    {
      id: playerStateNodeId("life"),
      label: "Life",
      quantity: player?.life ?? 0,
    },
    {
      id: playerStateNodeId("poison"),
      label: "Poison counters",
      quantity: player?.counters.poison ?? 0,
    },
    {
      id: playerStateNodeId("energy"),
      label: "Energy counters",
      quantity: player?.counters.energy ?? 0,
    },
    {
      id: playerStateNodeId("experience"),
      label: "Experience counters",
      quantity: player?.counters.experience ?? 0,
    },
    {
      id: playerStateNodeId("commander-damage"),
      label: "Commander damage",
      quantity: player?.counters.commanderDamage ?? 0,
    },
    {
      id: playerStateNodeId("controller:local"),
      label: "Local controller",
      quantity: 1,
    },
    {
      id: playerStateNodeId("owner:local"),
      label: "Local owner",
      quantity: 1,
    },
  ];

  for (const entry of playerNodes) {
    addNode(builder, {
      id: entry.id,
      type: "player-state",
      label: entry.label,
      groupId: null,
      objectIds: [],
      relevantTotal: null,
      zone: null,
      eventCategory: null,
      effectKind: null,
      quantity: entry.quantity,
      supportStatus: null,
      support: "fully-understood-consequence",
      enabled: true,
      disabledReason: "none",
      metadata: { localParticipantId: builder.context.localParticipantId },
    });
  }

  for (const [counterName, value] of Object.entries(
    player?.counters.custom ?? {},
  )) {
    addNode(builder, {
      id: playerStateNodeId(`custom:${normalizeIdPart(counterName)}`),
      type: "player-state",
      label: counterName,
      groupId: null,
      objectIds: [],
      relevantTotal: null,
      zone: null,
      eventCategory: null,
      effectKind: "custom-player-counter",
      quantity: value,
      supportStatus: null,
      support: "fully-understood-consequence",
      enabled: true,
      disabledReason: "none",
      metadata: { custom: true },
    });
  }
}

function addRelevantTotalNodes(builder: GraphBuilderState): void {
  for (const total of builder.context.relevantTotals) {
    addNode(builder, {
      id: totalNodeId(total.key),
      type: "relevant-total",
      label: total.key,
      groupId: null,
      objectIds: [],
      relevantTotal: total.key,
      zone: null,
      eventCategory: null,
      effectKind: null,
      quantity: total.value,
      supportStatus: null,
      support: "fully-understood-consequence",
      enabled: true,
      disabledReason: "none",
      metadata: { derived: true },
    });
  }
}

function addZoneNodes(builder: GraphBuilderState): void {
  const quantities = new Map(
    builder.context.zoneQuantities.map((entry) => [entry.zone, entry]),
  );
  for (const zone of ZONES) {
    const snapshot = quantities.get(zone);
    addNode(builder, {
      id: zoneNodeId(zone),
      type: "zone",
      label: zone,
      groupId: null,
      objectIds: [],
      relevantTotal: null,
      zone,
      eventCategory: null,
      effectKind: null,
      quantity: snapshot?.quantity ?? 0,
      supportStatus: null,
      support: "fully-understood-consequence",
      enabled: true,
      disabledReason: "none",
      metadata: { groupCount: snapshot?.groupCount ?? 0 },
    });
  }
}

function addEventCategoryNodes(builder: GraphBuilderState): void {
  for (const eventCategory of EVENT_CATEGORIES) {
    addNode(builder, {
      id: eventNodeId(eventCategory),
      type: "event-category",
      label: eventCategory,
      groupId: null,
      objectIds: [],
      relevantTotal: null,
      zone: null,
      eventCategory,
      effectKind: null,
      quantity: 0,
      supportStatus: null,
      support: "fully-understood-consequence",
      enabled: true,
      disabledReason: "none",
      metadata: { committedEvent: false },
    });
  }
}

function addObjectRelationships(builder: GraphBuilderState): void {
  for (const object of builder.context.battlefield) {
    const objectId = objectNodeId(object.groupId);
    addRelationship(builder, {
      type: "controls",
      from: playerStateNodeId("controller:local"),
      to: objectId,
      sourceGroupId: object.groupId,
      targetGroupIds: [object.groupId],
      sourceObjectIds: [],
      targetObjectIds: object.objectIds,
      eventCategories: [],
      relevantTotals: [],
      quantity: object.quantity,
      label: `Local participant controls ${object.label}.`,
      supportStatus: object.supportStatus,
      support: "fully-understood-consequence",
      enabled: true,
      disabledReason: "none",
      requiresAuthority: false,
      requiresManualResolution: false,
      invalidatesNodeIds: [],
      metadata: { controller: object.controller },
    });
    addRelationship(builder, {
      type: "owns",
      from: playerStateNodeId("owner:local"),
      to: objectId,
      sourceGroupId: object.groupId,
      targetGroupIds: [object.groupId],
      sourceObjectIds: [],
      targetObjectIds: object.objectIds,
      eventCategories: [],
      relevantTotals: [],
      quantity: object.quantity,
      label: `Local participant owns ${object.label}.`,
      supportStatus: object.supportStatus,
      support: "fully-understood-consequence",
      enabled: true,
      disabledReason: "none",
      requiresAuthority: false,
      requiresManualResolution: false,
      invalidatesNodeIds: [],
      metadata: { owner: object.owner },
    });

    for (const total of relevantTotalsForObject(object)) {
      addRelationship(builder, {
        type: "contributes-to",
        from: objectId,
        to: totalNodeId(total),
        sourceGroupId: object.groupId,
        targetGroupIds: [],
        sourceObjectIds: object.objectIds,
        targetObjectIds: [],
        eventCategories: [],
        relevantTotals: [total],
        quantity: object.quantity,
        label: `${object.label} contributes to ${total}.`,
        supportStatus: object.supportStatus,
        support: "fully-understood-consequence",
        enabled: true,
        disabledReason: "none",
        requiresAuthority: false,
        requiresManualResolution: false,
        invalidatesNodeIds: [totalNodeId(total)],
        metadata: {
          stackQuantityApplied: object.quantity,
          groupCountedOnceForTotal: true,
        },
      });
    }

    if (object.attachedTo) {
      const host = builder.context.battlefield.find(
        (entry) => entry.groupId === object.attachedTo,
      );
      const enabled = Boolean(host);
      if (!host) builder.staleReferences.add(object.attachedTo);
      addRelationship(builder, {
        type: "attached-to",
        from: objectId,
        to: host ? objectNodeId(host.groupId) : authorityNodeId("unsupported"),
        sourceGroupId: object.groupId,
        targetGroupIds: host ? [host.groupId] : [object.attachedTo],
        sourceObjectIds: object.objectIds,
        targetObjectIds: host?.objectIds ?? [],
        eventCategories: [],
        relevantTotals: ["equipment"],
        quantity: object.quantity,
        label: enabled
          ? `${object.label} is attached to ${host?.label}.`
          : `${object.label} has a stale attachment host reference.`,
        supportStatus: object.supportStatus,
        support: enabled
          ? "partially-understood-consequence"
          : "manual-resolution-required",
        enabled,
        disabledReason: enabled ? "none" : "missing-host",
        requiresAuthority: !enabled,
        requiresManualResolution: !enabled,
        invalidatesNodeIds: host ? [objectNodeId(host.groupId)] : [],
        metadata: { attachmentType: attachmentType(object) },
      });
    }

    if (object.isToken) {
      const tokenDefinitionId = addTokenDefinitionNode(builder, {
        id: tokenDefinitionIdForObject(object),
        name: object.identityName ?? object.label,
        power: object.basePower,
        toughness: object.baseToughness,
        cardTypes: object.cardTypes,
        subtypes: object.subtypes,
      });
      addRelationship(builder, {
        type: "derived-from",
        from: objectId,
        to: tokenDefinitionId,
        sourceGroupId: object.groupId,
        targetGroupIds: [],
        sourceObjectIds: object.objectIds,
        targetObjectIds: [],
        eventCategories: ["token-created", "token-entered"],
        relevantTotals: ["tokens"],
        quantity: object.quantity,
        label: `${object.label} is represented as one grouped token stack.`,
        supportStatus: object.supportStatus,
        support: "fully-understood-consequence",
        enabled: true,
        disabledReason: "none",
        requiresAuthority: false,
        requiresManualResolution: false,
        invalidatesNodeIds: [totalNodeId("tokens")],
        metadata: { stackQuantityApplied: object.quantity },
      });
    }

    if (object.quantity > 1) {
      addRelationship(builder, {
        type: "derived-from",
        from: objectId,
        to: objectId,
        sourceGroupId: object.groupId,
        targetGroupIds: [object.groupId],
        sourceObjectIds: object.objectIds,
        targetObjectIds: object.objectIds,
        eventCategories: [],
        relevantTotals: relevantTotalsForObject(object),
        quantity: object.quantity,
        label: `${object.label} preserves grouped stack lineage.`,
        supportStatus: object.supportStatus,
        support: "fully-understood-consequence",
        enabled: true,
        disabledReason: "none",
        requiresAuthority: false,
        requiresManualResolution: false,
        invalidatesNodeIds: relevantTotalsForObject(object).map(totalNodeId),
        metadata: { stackKey: object.stackKey },
      });
    }

    if (object.lineage.transformed) {
      const markerId = authorityNodeId(
        `lineage:${normalizeIdPart(object.originalCardId ?? object.lineage.originalName ?? object.groupId)}`,
      );
      addNode(builder, {
        id: markerId,
        type: "authority-marker",
        label: object.lineage.originalName ?? "Original form",
        groupId: object.groupId,
        objectIds: object.objectIds,
        relevantTotal: null,
        zone: null,
        eventCategory: null,
        effectKind: "transformed-lineage",
        quantity: object.quantity,
        supportStatus: object.supportStatus,
        support: "fully-understood-consequence",
        enabled: true,
        disabledReason: "none",
        metadata: { transformed: true, retroactiveEnter: false },
      });
      addRelationship(builder, {
        type: "derived-from",
        from: objectId,
        to: markerId,
        sourceGroupId: object.groupId,
        targetGroupIds: [object.groupId],
        sourceObjectIds: object.objectIds,
        targetObjectIds: object.objectIds,
        eventCategories: ["permanent-transformed"],
        relevantTotals: relevantTotalsForObject(object),
        quantity: object.quantity,
        label: `${object.label} retains object continuity after transformation.`,
        supportStatus: object.supportStatus,
        support: "fully-understood-consequence",
        enabled: true,
        disabledReason: "none",
        requiresAuthority: false,
        requiresManualResolution: false,
        invalidatesNodeIds: [
          objectId,
          ...relevantTotalsForObject(object).map(totalNodeId),
        ],
        metadata: { retroactiveEnter: false },
      });
    }

    if (object.sourceUnavailableReason === "unsupported-effect") {
      addRelationship(builder, {
        type: "requires-authority",
        from: objectId,
        to: authorityNodeId("unsupported"),
        sourceGroupId: object.groupId,
        targetGroupIds: [object.groupId],
        sourceObjectIds: object.objectIds,
        targetObjectIds: object.objectIds,
        eventCategories: [],
        relevantTotals: [],
        quantity: object.quantity,
        label: `${object.label} has unsupported text and remains outside Lite helper authority.`,
        supportStatus: object.supportStatus,
        support: "unsupported-effect",
        enabled: false,
        disabledReason: "support-boundary",
        requiresAuthority: true,
        requiresManualResolution: true,
        invalidatesNodeIds: [objectId],
        metadata: { localHelperAuthority: false },
      });
    }
  }
}

function addDefinitionRelationships(builder: GraphBuilderState): void {
  const definitions = builder.context.battlefield.flatMap((object) =>
    definitionsForObject(object, builder),
  );

  for (const definition of definitions) {
    addDefinitionNode(builder, definition);
    for (const eventCategory of definition.observes) {
      addRelationship(builder, {
        type: "observes",
        from: effectNodeId(definition.id),
        to: eventNodeId(eventCategory),
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: [],
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: [],
        eventCategories: [eventCategory],
        relevantTotals: [],
        quantity: 1,
        label: `${definition.label} observes ${eventCategory}.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: definition.enabled,
        disabledReason: definition.disabledReason,
        requiresAuthority: definition.requiresAuthority,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: [eventNodeId(eventCategory)],
        metadata: definition.metadata,
      });
    }
    for (const eventCategory of definition.modifies) {
      addRelationship(builder, {
        type: "modifies",
        from: effectNodeId(definition.id),
        to: eventNodeId(eventCategory),
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: [],
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: [],
        eventCategories: [eventCategory],
        relevantTotals: [],
        quantity: 1,
        label: `${definition.label} can modify ${eventCategory}.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: definition.enabled,
        disabledReason: definition.disabledReason,
        requiresAuthority: definition.requiresAuthority,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: [eventNodeId(eventCategory)],
        metadata: definition.metadata,
      });
    }
    for (const total of definition.reads) {
      addRelationship(builder, {
        type: "reads",
        from: effectNodeId(definition.id),
        to: totalNodeId(total),
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: [],
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: [],
        eventCategories: [],
        relevantTotals: [total],
        quantity: 1,
        label: `${definition.label} reads ${total}.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: definition.enabled,
        disabledReason: definition.disabledReason,
        requiresAuthority: definition.requiresAuthority,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: [effectNodeId(definition.id)],
        metadata: definition.metadata,
      });
    }
    for (const token of definition.creates) {
      const tokenNodeId = addTokenDefinitionNode(builder, token);
      addRelationship(builder, {
        type: "creates",
        from: effectNodeId(definition.id),
        to: tokenNodeId,
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: [],
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: [],
        eventCategories: ["token-created", "token-entered"],
        relevantTotals: ["tokens"],
        quantity: 1,
        label: `${definition.label} can create ${token.name}.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: definition.enabled,
        disabledReason: definition.disabledReason,
        requiresAuthority: definition.requiresAuthority,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: [
          totalNodeId("tokens"),
          eventNodeId("token-created"),
        ],
        metadata: definition.metadata,
      });
    }
    for (const counter of definition.counters) {
      const counterNodeId = addCounterDefinitionNode(builder, counter.name);
      addRelationship(builder, {
        type: "places-counters-on",
        from: effectNodeId(definition.id),
        to: counterNodeId,
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: targetObjectsForDefinition(builder, definition).map(
          (object) => object.groupId,
        ),
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: targetObjectsForDefinition(
          builder,
          definition,
        ).flatMap((object) => object.objectIds),
        eventCategories: ["counter-placed"],
        relevantTotals: [],
        quantity: 1,
        label: `${definition.label} can place ${counter.name} counters.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: definition.enabled,
        disabledReason: definition.disabledReason,
        requiresAuthority: definition.requiresAuthority,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: targetObjectsForDefinition(builder, definition).map(
          (object) => objectNodeId(object.groupId),
        ),
        metadata: definition.metadata,
      });
    }
    for (const target of targetObjectsForDefinition(builder, definition)) {
      if (definition.affects === "none") continue;
      addRelationship(builder, {
        type: "affects",
        from: effectNodeId(definition.id),
        to: objectNodeId(target.groupId),
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: [target.groupId],
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: target.objectIds,
        eventCategories: [],
        relevantTotals: relevantTotalsForObject(target),
        quantity: target.quantity,
        label: `${definition.label} may affect ${target.label}.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: definition.enabled && target.canBeEffectRecipient,
        disabledReason:
          definition.enabled && target.canBeEffectRecipient
            ? "none"
            : definition.disabledReason,
        requiresAuthority: definition.requiresAuthority,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: [
          objectNodeId(target.groupId),
          ...relevantTotalsForObject(target).map(totalNodeId),
        ],
        metadata: definition.metadata,
      });
    }
    if (definition.requiresAuthority) {
      addRelationship(builder, {
        type: "requires-authority",
        from: effectNodeId(definition.id),
        to: authorityNodeId("boardstate-authority"),
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: definition.sourceGroupId
          ? [definition.sourceGroupId]
          : [],
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: [],
        eventCategories: definition.observes,
        relevantTotals: definition.reads,
        quantity: 1,
        label: `${definition.label} requires authority before local resolution.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: false,
        disabledReason: "authority-required",
        requiresAuthority: true,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: [effectNodeId(definition.id)],
        metadata: definition.metadata,
      });
    }
  }
}

function addCustomEffectRelationships(builder: GraphBuilderState): void {
  if (!builder.field) return;
  for (const effect of builder.field.customEffects) {
    const sourceGroupId = customEffectSourceGroupId(effect);
    const sourceObject = sourceGroupId
      ? builder.context.battlefield.find(
          (object) => object.groupId === sourceGroupId,
        )
      : null;
    const enabled =
      effect.enabled && (!sourceObject || sourceObject.canBeEffectSource);
    const disabledReason = enabled
      ? "none"
      : (sourceObject?.sourceUnavailableReason ?? "manual-resolution-required");
    const definition: GraphDefinition = {
      id: `custom:${effect.id}`,
      label: effect.name,
      effectKind: "custom-automation",
      sourceGroupId,
      sourceObjectIds: sourceObject?.objectIds ?? [],
      observes: [eventCategoryForCustomTrigger(effect.trigger)],
      modifies: [],
      reads: totalsReadByValueExpression(effect.action.amount),
      affects: customEffectTarget(effect),
      creates:
        effect.action.kind === "create-token"
          ? [
              {
                id: `custom:${effect.id}:token:${normalizeIdPart(effect.action.name)}`,
                name: effect.action.name,
                power: effect.action.power,
                toughness: effect.action.toughness,
                cardTypes: effect.action.cardTypes,
                subtypes: effect.action.subtypes,
              },
            ]
          : [],
      counters:
        effect.action.kind === "add-counters"
          ? [
              {
                id: `custom:${effect.id}:counter:${normalizeIdPart(effect.action.counter)}`,
                name: effect.action.counter,
                target: customEffectTarget(effect),
              },
            ]
          : [],
      supportStatus: "partially-automated",
      support: "partially-understood-consequence",
      authoritySource: "confirmed-user-report",
      enabled,
      disabledReason,
      requiresAuthority: false,
      requiresManualResolution:
        effect.action.kind === "add-counters" &&
        effect.action.target === "selected",
      metadata: {
        custom: true,
        trigger: effect.trigger,
        action: effect.action.kind,
        enabled: effect.enabled,
      },
    };
    addDefinitionNode(builder, definition);
    for (const eventCategory of definition.observes) {
      addRelationship(builder, {
        type: "observes",
        from: effectNodeId(definition.id),
        to: eventNodeId(eventCategory),
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: [],
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: [],
        eventCategories: [eventCategory],
        relevantTotals: [],
        quantity: 1,
        label: `${definition.label} observes ${eventCategory}.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: definition.enabled,
        disabledReason: definition.disabledReason,
        requiresAuthority: false,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: [eventNodeId(eventCategory)],
        metadata: definition.metadata,
      });
    }
    for (const total of definition.reads) {
      addRelationship(builder, {
        type: "reads",
        from: effectNodeId(definition.id),
        to: totalNodeId(total),
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: [],
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: [],
        eventCategories: [],
        relevantTotals: [total],
        quantity: 1,
        label: `${definition.label} reads ${total}.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: definition.enabled,
        disabledReason: definition.disabledReason,
        requiresAuthority: false,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: [effectNodeId(definition.id)],
        metadata: definition.metadata,
      });
    }
    for (const token of definition.creates) {
      const tokenNodeId = addTokenDefinitionNode(builder, token);
      addRelationship(builder, {
        type: "creates",
        from: effectNodeId(definition.id),
        to: tokenNodeId,
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: [],
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: [],
        eventCategories: ["token-created", "token-entered"],
        relevantTotals: ["tokens"],
        quantity: 1,
        label: `${definition.label} can create ${token.name}.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: definition.enabled,
        disabledReason: definition.disabledReason,
        requiresAuthority: false,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: [
          totalNodeId("tokens"),
          eventNodeId("token-created"),
        ],
        metadata: definition.metadata,
      });
    }
    for (const counter of definition.counters) {
      const targets = targetObjectsForDefinition(builder, definition);
      addRelationship(builder, {
        type: "places-counters-on",
        from: effectNodeId(definition.id),
        to: addCounterDefinitionNode(builder, counter.name),
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: targets.map((object) => object.groupId),
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: targets.flatMap((object) => object.objectIds),
        eventCategories: ["counter-placed"],
        relevantTotals: [],
        quantity: 1,
        label: `${definition.label} can place ${counter.name} counters.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: definition.enabled,
        disabledReason: definition.disabledReason,
        requiresAuthority: false,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: targets.map((object) =>
          objectNodeId(object.groupId),
        ),
        metadata: definition.metadata,
      });
    }
    for (const target of targetObjectsForDefinition(builder, definition)) {
      if (definition.affects === "none") continue;
      addRelationship(builder, {
        type: "affects",
        from: effectNodeId(definition.id),
        to: objectNodeId(target.groupId),
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: [target.groupId],
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: target.objectIds,
        eventCategories: [],
        relevantTotals: relevantTotalsForObject(target),
        quantity: target.quantity,
        label: `${definition.label} may affect ${target.label}.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: definition.enabled && target.canBeEffectRecipient,
        disabledReason:
          definition.enabled && target.canBeEffectRecipient
            ? "none"
            : definition.disabledReason,
        requiresAuthority: false,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: [
          objectNodeId(target.groupId),
          ...relevantTotalsForObject(target).map(totalNodeId),
        ],
        metadata: definition.metadata,
      });
    }
    if (definition.requiresManualResolution) {
      addRelationship(builder, {
        type: "requires-choice",
        from: effectNodeId(definition.id),
        to: authorityNodeId("unsupported"),
        sourceGroupId: definition.sourceGroupId,
        targetGroupIds: [],
        sourceObjectIds: definition.sourceObjectIds,
        targetObjectIds: [],
        eventCategories: definition.observes,
        relevantTotals: definition.reads,
        quantity: 1,
        label: `${definition.label} requires a target choice.`,
        supportStatus: definition.supportStatus,
        support: "missing-choice",
        enabled: false,
        disabledReason: "manual-resolution-required",
        requiresAuthority: false,
        requiresManualResolution: true,
        invalidatesNodeIds: [effectNodeId(definition.id)],
        metadata: definition.metadata,
      });
    }
  }
}

function addInvalidationRelationships(builder: GraphBuilderState): void {
  const readersByTotal = new Map<RelevantTotalKey, GraphDefinition[]>();
  for (const object of builder.context.battlefield) {
    for (const definition of definitionsForObject(object, builder)) {
      for (const total of definition.reads) {
        const existing = readersByTotal.get(total) ?? [];
        existing.push(definition);
        readersByTotal.set(total, existing);
      }
    }
  }

  for (const object of builder.context.battlefield) {
    for (const total of relevantTotalsForObject(object)) {
      addRelationship(builder, {
        type: "invalidates",
        from: objectNodeId(object.groupId),
        to: totalNodeId(total),
        sourceGroupId: object.groupId,
        targetGroupIds: [],
        sourceObjectIds: object.objectIds,
        targetObjectIds: [],
        eventCategories: [],
        relevantTotals: [total],
        quantity: object.quantity,
        label: `${object.label} changes invalidate ${total}.`,
        supportStatus: object.supportStatus,
        support: "fully-understood-consequence",
        enabled: true,
        disabledReason: "none",
        requiresAuthority: false,
        requiresManualResolution: false,
        invalidatesNodeIds: [totalNodeId(total)],
        metadata: { invalidationScope: "relevant-total" },
      });
    }
  }

  for (const [total, definitions] of readersByTotal) {
    for (const definition of definitions) {
      addRelationship(builder, {
        type: "invalidates",
        from: totalNodeId(total),
        to: effectNodeId(definition.id),
        sourceGroupId: null,
        targetGroupIds: definition.sourceGroupId
          ? [definition.sourceGroupId]
          : [],
        sourceObjectIds: [],
        targetObjectIds: definition.sourceObjectIds,
        eventCategories: [],
        relevantTotals: [total],
        quantity: 1,
        label: `${total} changes invalidate ${definition.label}.`,
        supportStatus: definition.supportStatus,
        support: definition.support,
        enabled: definition.enabled,
        disabledReason: definition.disabledReason,
        requiresAuthority: definition.requiresAuthority,
        requiresManualResolution: definition.requiresManualResolution,
        invalidatesNodeIds: [effectNodeId(definition.id)],
        metadata: { invalidationScope: "static-reader" },
      });
    }
  }
}

function definitionsForObject(
  object: AthenaBattlefieldObject,
  builder: GraphBuilderState,
): GraphDefinition[] {
  if (object.isGeneric) return [];
  const disabledReason: AthenaGraphDisabledReason = object.canBeEffectSource
    ? "none"
    : (object.sourceUnavailableReason ?? "support-boundary");
  const enabled = object.canBeEffectSource;
  const base = {
    sourceGroupId: object.groupId,
    sourceObjectIds: object.objectIds,
    supportStatus: object.supportStatus,
    support: supportForStatus(object.supportStatus, false),
    authoritySource: builder.authoritySource,
    enabled,
    disabledReason,
    requiresAuthority: object.sourceUnavailableReason === "unsupported-effect",
    requiresManualResolution:
      object.sourceUnavailableReason === "unsupported-effect" ||
      object.sourceUnavailableReason === "quantity-only",
  };
  const normalizedName = (object.identityName ?? object.label).toLowerCase();
  const text = (object.oracleText ?? "").toLowerCase();
  const definitions: GraphDefinition[] = [];

  if (normalizedName.includes("anim pakal")) {
    definitions.push({
      ...base,
      id: `${object.groupId}:anim-pakal-attack-trigger`,
      label: `${object.label} attack trigger`,
      effectKind: "triggered-ability",
      observes: ["attack-declared"],
      modifies: [],
      reads: [],
      affects: "self",
      creates: [
        {
          id: `${object.groupId}:gnome-token`,
          name: "Gnome",
          power: 1,
          toughness: 1,
          cardTypes: ["Artifact", "Creature"],
          subtypes: ["Gnome"],
        },
      ],
      counters: [
        { id: `${object.groupId}:+1/+1`, name: "+1/+1", target: "self" },
      ],
      metadata: { helper: "anim-pakal", localHelperAuthority: true },
    });
  }
  if (normalizedName.includes("cathars' crusade")) {
    definitions.push({
      ...base,
      id: `${object.groupId}:cathars-crusade`,
      label: `${object.label} creature-entry trigger`,
      effectKind: "triggered-ability",
      observes: ["creature-entered"],
      modifies: [],
      reads: ["creatures"],
      affects: "creatures",
      creates: [],
      counters: [
        {
          id: `${object.groupId}:all-creatures:+1/+1`,
          name: "+1/+1",
          target: "creatures",
        },
      ],
      metadata: { helper: "cathars-crusade", localHelperAuthority: true },
    });
  }
  if (normalizedName.includes("doubling season")) {
    definitions.push({
      ...base,
      id: `${object.groupId}:doubling-season`,
      label: `${object.label} replacement boundary`,
      effectKind: "replacement-effect",
      observes: [],
      modifies: ["token-created", "counter-placed"],
      reads: [],
      affects: "battlefield",
      creates: [],
      counters: [],
      metadata: { helper: "doubling-season", localHelperAuthority: true },
    });
  }
  if (
    normalizedName.includes("soul warden") ||
    normalizedName.includes("essence warden")
  ) {
    definitions.push({
      ...base,
      id: `${object.groupId}:life-on-creature-entry`,
      label: `${object.label} life trigger`,
      effectKind: "triggered-ability",
      observes: ["creature-entered"],
      modifies: [],
      reads: [],
      affects: "players",
      creates: [],
      counters: [],
      metadata: {
        helper: "life-on-creature-entry",
        localHelperAuthority: true,
      },
    });
  }
  if (normalizedName.includes("impact tremors")) {
    definitions.push({
      ...base,
      id: `${object.groupId}:impact-tremors`,
      label: `${object.label} damage trigger`,
      effectKind: "triggered-ability",
      observes: ["creature-entered"],
      modifies: [],
      reads: [],
      affects: "players",
      creates: [],
      counters: [],
      metadata: { helper: "impact-tremors", localHelperAuthority: true },
    });
  }
  if (normalizedName.includes("rampaging baloths")) {
    definitions.push({
      ...base,
      id: `${object.groupId}:rampaging-baloths-landfall`,
      label: `${object.label} landfall trigger`,
      effectKind: "triggered-ability",
      observes: ["land-entered"],
      modifies: [],
      reads: ["lands"],
      affects: "none",
      creates: [
        {
          id: `${object.groupId}:beast-token`,
          name: "Beast",
          power: 4,
          toughness: 4,
          cardTypes: ["Creature"],
          subtypes: ["Beast"],
        },
      ],
      counters: [],
      metadata: { helper: "rampaging-baloths", localHelperAuthority: true },
    });
  }

  const staticReads = relevantTotalsForText(text);
  if (
    staticReads.length > 0 &&
    !definitions.some((definition) => definition.reads.length > 0)
  ) {
    definitions.push({
      ...base,
      id: `${object.groupId}:static-total-reader`,
      label: `${object.label} static total reader`,
      effectKind: "static-effect",
      observes: [],
      modifies: [],
      reads: staticReads,
      affects: staticEffectTargetForText(text),
      creates: [],
      counters: [],
      metadata: { inferredFromStructuredTextBoundary: true },
    });
  }

  const observedEvents = eventCategoriesForText(text);
  if (
    observedEvents.length > 0 &&
    definitions.length === 0 &&
    object.supportStatus !== "unsupported"
  ) {
    definitions.push({
      ...base,
      id: `${object.groupId}:supported-event-boundary`,
      label: `${object.label} supported event boundary`,
      effectKind: "triggered-ability",
      observes: observedEvents,
      modifies: replacementEventsForText(text),
      reads: staticReads,
      affects: "battlefield",
      creates: tokenDefinitionsForText(object, text),
      counters: counterDefinitionsForText(object, text),
      metadata: { structuredAwarenessBoundary: true },
    });
  }

  return definitions;
}

function staticEffectTargetForText(text: string): DefinitionTarget {
  if (text.includes("creatures you control get")) return "creatures";
  if (text.includes("gets +")) return "self";
  if (text.includes("equipped creature")) return "creatures";
  if (text.includes("creature")) return "creatures";
  return "battlefield";
}

function targetObjectsForDefinition(
  builder: GraphBuilderState,
  definition: GraphDefinition,
): AthenaBattlefieldObject[] {
  if (definition.affects === "none") return [];
  if (definition.affects === "players") return [];
  if (definition.affects === "self") {
    return builder.context.battlefield.filter(
      (object) => object.groupId === definition.sourceGroupId,
    );
  }
  if (definition.affects === "creatures") {
    return builder.context.battlefield.filter((object) => object.isCreature);
  }
  return builder.context.battlefield.filter(
    (object) => object.zone === "battlefield",
  );
}

function addNode(
  builder: GraphBuilderState,
  node: Omit<
    AthenaGraphNode,
    | "fieldId"
    | "sessionId"
    | "authoritySource"
    | "authorityPrecedence"
    | "fingerprint"
  >,
): void {
  const next: AthenaGraphNode = {
    ...node,
    fieldId: builder.context.fieldId,
    sessionId: builder.context.sessionId,
    authoritySource: builder.authoritySource,
    authorityPrecedence: builder.authorityPrecedence,
    objectIds: sortStrings(node.objectIds),
    fingerprint: fingerprintValue({
      id: node.id,
      type: node.type,
      groupId: node.groupId,
      relevantTotal: node.relevantTotal,
      zone: node.zone,
      eventCategory: node.eventCategory,
      quantity: node.quantity,
      enabled: node.enabled,
      disabledReason: node.disabledReason,
      metadata: node.metadata,
    }),
  };
  builder.nodes.set(next.id, next);
}

function addDefinitionNode(
  builder: GraphBuilderState,
  definition: GraphDefinition,
): void {
  addNode(builder, {
    id: effectNodeId(definition.id),
    type: "effect-definition",
    label: definition.label,
    groupId: definition.sourceGroupId,
    objectIds: definition.sourceObjectIds,
    relevantTotal: null,
    zone: null,
    eventCategory: null,
    effectKind: definition.effectKind,
    quantity: 1,
    supportStatus: definition.supportStatus,
    support: definition.support,
    enabled: definition.enabled,
    disabledReason: definition.disabledReason,
    metadata: definition.metadata,
  });
}

function addTokenDefinitionNode(
  builder: GraphBuilderState,
  token: TokenDefinition,
): string {
  const id = tokenDefinitionNodeId(token.id);
  addNode(builder, {
    id,
    type: "token-definition",
    label: token.name,
    groupId: null,
    objectIds: [],
    relevantTotal: null,
    zone: null,
    eventCategory: null,
    effectKind: "token-definition",
    quantity: 1,
    supportStatus: "quantity-tracking-only",
    support: "fully-understood-consequence",
    enabled: true,
    disabledReason: "none",
    metadata: {
      power: token.power,
      toughness: token.toughness,
      cardTypes: token.cardTypes.join(" "),
      subtypes: token.subtypes.join(" "),
    },
  });
  return id;
}

function addCounterDefinitionNode(
  builder: GraphBuilderState,
  counterName: string,
): string {
  const id = counterDefinitionNodeId(counterName);
  addNode(builder, {
    id,
    type: "counter-definition",
    label: counterName,
    groupId: null,
    objectIds: [],
    relevantTotal: null,
    zone: null,
    eventCategory: null,
    effectKind: "counter-definition",
    quantity: 0,
    supportStatus: null,
    support: "fully-understood-consequence",
    enabled: true,
    disabledReason: "none",
    metadata: { counterName },
  });
  return id;
}

function addRelationship(
  builder: GraphBuilderState,
  relationship: Omit<
    AthenaGraphRelationship,
    | "id"
    | "fieldId"
    | "sessionId"
    | "authoritySource"
    | "authorityPrecedence"
    | "definitionVersion"
  >,
): void {
  const id = relationshipId(relationship);
  const next: AthenaGraphRelationship = {
    ...relationship,
    id,
    fieldId: builder.context.fieldId,
    sessionId: builder.context.sessionId,
    authoritySource:
      relationship.metadata.localHelperAuthority === true
        ? "lite-local-helper-result"
        : builder.authoritySource,
    authorityPrecedence:
      relationship.metadata.localHelperAuthority === true
        ? rankAthenaAuthoritySource("lite-local-helper-result")
        : builder.authorityPrecedence,
    sourceObjectIds: sortStrings(relationship.sourceObjectIds),
    targetGroupIds: sortStrings(relationship.targetGroupIds),
    targetObjectIds: sortStrings(relationship.targetObjectIds),
    eventCategories: sortStrings(
      relationship.eventCategories,
    ) as AthenaEventCategory[],
    relevantTotals: sortStrings(
      relationship.relevantTotals,
    ) as RelevantTotalKey[],
    invalidatesNodeIds: sortStrings(relationship.invalidatesNodeIds),
    definitionVersion: ATHENA_DEPENDENCY_GRAPH_VERSION,
  };
  if (!builder.nodes.has(next.from)) builder.staleReferences.add(next.from);
  if (!builder.nodes.has(next.to)) builder.staleReferences.add(next.to);
  builder.relationships.set(id, next);
}

function buildIndexes(
  nodes: AthenaGraphNode[],
  relationships: AthenaGraphRelationship[],
): AthenaGraphIndexes {
  const nodeIdsByType = Object.fromEntries(
    GRAPH_NODE_TYPES.map((type) => [type, [] as string[]]),
  ) as Record<AthenaGraphNodeType, string[]>;
  const relationshipIdsByType = Object.fromEntries(
    GRAPH_RELATIONSHIP_TYPES.map((type) => [type, [] as string[]]),
  ) as Record<AthenaGraphRelationshipType, string[]>;
  const indexes: AthenaGraphIndexes = {
    nodeIdsByType,
    relationshipIdsByType,
    relationshipsBySource: {},
    relationshipsByTarget: {},
    relationshipsByGroupId: {},
    observersByEvent: {},
    modifiersByEvent: {},
    readersByTotal: {},
    contributorsByTotal: {},
    attachmentsByHost: {},
    disabledByReason: {},
    unsupportedRelationshipIds: [],
    authorityRequiredRelationshipIds: [],
  };

  for (const node of nodes) {
    indexes.nodeIdsByType[node.type].push(node.id);
  }
  for (const relationship of relationships) {
    indexes.relationshipIdsByType[relationship.type].push(relationship.id);
    pushIndex(
      indexes.relationshipsBySource,
      relationship.from,
      relationship.id,
    );
    pushIndex(indexes.relationshipsByTarget, relationship.to, relationship.id);
    if (relationship.sourceGroupId) {
      pushIndex(
        indexes.relationshipsByGroupId,
        relationship.sourceGroupId,
        relationship.id,
      );
    }
    for (const groupId of relationship.targetGroupIds) {
      pushIndex(indexes.relationshipsByGroupId, groupId, relationship.id);
    }
    if (relationship.type === "observes") {
      for (const eventCategory of relationship.eventCategories) {
        pushIndex(indexes.observersByEvent, eventCategory, relationship.id);
      }
    }
    if (relationship.type === "modifies") {
      for (const eventCategory of relationship.eventCategories) {
        pushIndex(indexes.modifiersByEvent, eventCategory, relationship.id);
      }
    }
    if (relationship.type === "reads") {
      for (const total of relationship.relevantTotals) {
        pushIndex(indexes.readersByTotal, total, relationship.id);
      }
    }
    if (relationship.type === "contributes-to") {
      for (const total of relationship.relevantTotals) {
        pushIndex(indexes.contributorsByTotal, total, relationship.id);
      }
    }
    if (relationship.type === "attached-to") {
      pushIndex(indexes.attachmentsByHost, relationship.to, relationship.id);
    }
    if (!relationship.enabled) {
      pushIndex(
        indexes.disabledByReason,
        relationship.disabledReason,
        relationship.id,
      );
    }
    if (relationship.support === "unsupported-effect") {
      indexes.unsupportedRelationshipIds.push(relationship.id);
    }
    if (relationship.requiresAuthority) {
      indexes.authorityRequiredRelationshipIds.push(relationship.id);
    }
  }

  for (const value of Object.values(indexes.nodeIdsByType)) value.sort();
  for (const value of Object.values(indexes.relationshipIdsByType))
    value.sort();
  sortIndex(indexes.relationshipsBySource);
  sortIndex(indexes.relationshipsByTarget);
  sortIndex(indexes.relationshipsByGroupId);
  sortIndex(indexes.observersByEvent);
  sortIndex(indexes.modifiersByEvent);
  sortIndex(indexes.readersByTotal);
  sortIndex(indexes.contributorsByTotal);
  sortIndex(indexes.attachmentsByHost);
  sortIndex(indexes.disabledByReason);
  indexes.unsupportedRelationshipIds.sort();
  indexes.authorityRequiredRelationshipIds.sort();
  return indexes;
}

function createGraphDiagnostics(input: {
  nodes: AthenaGraphNode[];
  relationships: AthenaGraphRelationship[];
  fullRebuildDurationMs: number;
  incrementalUpdateDurationMs: number;
  staleReferenceCount: number;
  cycleCount: number;
  lastRebuildReason: AthenaGraphBuildReason;
  lastInvalidationSet: string[];
  lastError: string | null;
}): AthenaGraphDiagnostics {
  return {
    graphVersion: ATHENA_DEPENDENCY_GRAPH_VERSION,
    cacheVersion: ATHENA_DEPENDENCY_GRAPH_CACHE_VERSION,
    nodeCount: input.nodes.length,
    relationshipCount: input.relationships.length,
    activeRelationshipCount: input.relationships.filter(
      (relationship) => relationship.enabled,
    ).length,
    disabledRelationshipCount: input.relationships.filter(
      (relationship) => !relationship.enabled,
    ).length,
    unsupportedRelationshipCount: input.relationships.filter(
      (relationship) => relationship.support === "unsupported-effect",
    ).length,
    authorityRequiredRelationshipCount: input.relationships.filter(
      (relationship) => relationship.requiresAuthority,
    ).length,
    fullRebuildDurationMs: input.fullRebuildDurationMs,
    incrementalUpdateDurationMs: input.incrementalUpdateDurationMs,
    lastInvalidationSet: sortStrings(input.lastInvalidationSet),
    staleReferenceCount: input.staleReferenceCount,
    cycleCount: input.cycleCount,
    lastRebuildReason: input.lastRebuildReason,
    lastError: input.lastError,
    directBattlefieldMutation: false,
    duplicateBattlefieldState: false,
  };
}

function relationshipsForObject(
  graph: AthenaDependencyGraph,
  groupId: string,
): AthenaGraphRelationship[] {
  return relationshipsFromIndex(
    graph,
    graph.indexes.relationshipsByGroupId[groupId],
  );
}

function relationshipsFromIndex(
  graph: AthenaDependencyGraph,
  ids: string[] | undefined,
): AthenaGraphRelationship[] {
  if (!ids) return [];
  return ids
    .map((id) => relationshipById(graph, id))
    .filter((relationship): relationship is AthenaGraphRelationship =>
      Boolean(relationship),
    );
}

function nodeById(
  graph: AthenaDependencyGraph,
  id: string,
): AthenaGraphNode | null {
  return graph.nodes.find((node) => node.id === id) ?? null;
}

function relationshipById(
  graph: AthenaDependencyGraph,
  id: string,
): AthenaGraphRelationship | null {
  return (
    graph.relationships.find((relationship) => relationship.id === id) ?? null
  );
}

function resolveChangedNodeIds(
  graph: AthenaDependencyGraph,
  change: AthenaGraphChange,
): string[] {
  const nodeIds = new Set<string>(change.nodeIds ?? []);
  for (const groupId of change.groupIds ?? []) {
    nodeIds.add(objectNodeId(groupId));
    for (const relationshipId of graph.indexes.relationshipsByGroupId[
      groupId
    ] ?? []) {
      const relationship = relationshipById(graph, relationshipId);
      if (relationship) {
        nodeIds.add(relationship.from);
        nodeIds.add(relationship.to);
      }
    }
  }
  for (const eventCategory of change.eventCategories ?? []) {
    nodeIds.add(eventNodeId(eventCategory));
  }
  for (const total of change.relevantTotals ?? []) {
    nodeIds.add(totalNodeId(total));
  }
  for (const zone of change.zones ?? []) {
    nodeIds.add(zoneNodeId(zone));
  }
  for (const relationshipId of change.relationshipIds ?? []) {
    const relationship = relationshipById(graph, relationshipId);
    if (relationship) {
      nodeIds.add(relationship.from);
      nodeIds.add(relationship.to);
    }
  }
  return sortStrings([...nodeIds]).filter((id) =>
    graph.nodes.some((node) => node.id === id),
  );
}

function dependenciesForEchoIntent(
  graph: AthenaDependencyGraph,
  intent: Pick<AmbientIntent, "id" | "kind" | "entities">,
): AthenaEchoDependencyQueryResult {
  const eventCategories = eventCategoriesForIntent(intent.kind);
  const relevantTotals = relevantTotalsForIntent(intent.kind, intent.entities);
  const observers = uniqueRelationships(
    eventCategories.flatMap((eventCategory) =>
      relationshipsFromIndex(
        graph,
        graph.indexes.observersByEvent[eventCategory],
      ),
    ),
  );
  const modifiers = uniqueRelationships(
    eventCategories.flatMap((eventCategory) =>
      relationshipsFromIndex(
        graph,
        graph.indexes.modifiersByEvent[eventCategory],
      ),
    ),
  );
  const staticReaders = uniqueRelationships(
    relevantTotals.flatMap((total) =>
      relationshipsFromIndex(graph, graph.indexes.readersByTotal[total]),
    ),
  );
  const contributors = uniqueRelationships(
    relevantTotals.flatMap((total) =>
      relationshipsFromIndex(graph, graph.indexes.contributorsByTotal[total]),
    ),
  );
  const combined = uniqueRelationships([
    ...observers,
    ...modifiers,
    ...staticReaders,
    ...contributors,
  ]);
  return {
    intentId: intent.id,
    intentKind: intent.kind,
    eventCategories,
    relevantTotals,
    observers,
    modifiers,
    staticReaders,
    contributors,
    disabledRelationships: combined.filter(
      (relationship) => !relationship.enabled,
    ),
    unsupportedRelationships: combined.filter(
      (relationship) => relationship.support === "unsupported-effect",
    ),
    authorityRequiredRelationships: combined.filter(
      (relationship) => relationship.requiresAuthority,
    ),
  };
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

function relevantTotalsForIntent(
  kind: AmbientIntentKind,
  entities: AmbientEntityReference[],
): RelevantTotalKey[] {
  const totals = new Set<RelevantTotalKey>();
  if (kind === "play-land") totals.add("lands");
  if (kind === "create-token") totals.add("tokens");
  if (kind === "attack") totals.add("creatures");
  for (const entity of entities) {
    if (entity.kind === "total") totals.add(entity.key);
    if (entity.kind === "zone" && entity.zone === "graveyard") {
      totals.add("cardsInGraveyard");
    }
    if (entity.kind === "zone" && entity.zone === "exile") {
      totals.add("cardsInExile");
    }
    if (entity.kind === "zone" && entity.zone === "hand") {
      totals.add("cardsInHand");
    }
  }
  return sortStrings([...totals]) as RelevantTotalKey[];
}

function supportForStatus(
  supportStatus: SupportStatus | null,
  isGeneric: boolean,
): AthenaSupportFindingStatus {
  if (isGeneric) return "fully-understood-consequence";
  if (supportStatus === "fully-automated")
    return "fully-understood-consequence";
  if (supportStatus === "partially-automated") {
    return "partially-understood-consequence";
  }
  if (supportStatus === "quantity-tracking-only") {
    return "manual-resolution-required";
  }
  return "unsupported-effect";
}

function relevantTotalsForObject(
  object: AthenaBattlefieldObject,
): RelevantTotalKey[] {
  const totals: RelevantTotalKey[] = [];
  const types = new Set(object.cardTypes);
  const subtypes = new Set(object.subtypes);
  const supertypes = new Set(object.supertypes);
  if (object.zone === "hand") totals.push("cardsInHand");
  if (object.zone === "graveyard") totals.push("cardsInGraveyard");
  if (object.zone === "exile") totals.push("cardsInExile");
  if (object.zone === "library") totals.push("cardsRemainingInLibrary");
  if (object.zone !== "battlefield")
    return sortStrings(totals) as RelevantTotalKey[];

  if (types.has("Land")) totals.push("lands");
  if (types.has("Land") && supertypes.has("Basic")) totals.push("basicLands");
  if (types.has("Land") && !supertypes.has("Basic")) {
    totals.push("nonbasicLands");
  }
  if (subtypes.has("Plains")) totals.push("plains");
  if (subtypes.has("Island")) totals.push("islands");
  if (subtypes.has("Swamp")) totals.push("swamps");
  if (subtypes.has("Mountain")) totals.push("mountains");
  if (subtypes.has("Forest")) totals.push("forests");
  if (subtypes.has("Gate")) totals.push("gates");
  if (subtypes.has("Desert")) totals.push("deserts");
  if (subtypes.has("Cave")) totals.push("caves");
  if (subtypes.has("Locus")) totals.push("loci");
  if (subtypes.has("Sphere")) totals.push("spheres");
  if (types.has("Creature")) totals.push("creatures");
  if (types.has("Artifact")) totals.push("artifacts");
  if (subtypes.has("Equipment")) totals.push("equipment");
  if (types.has("Enchantment")) totals.push("enchantments");
  if (subtypes.has("Aura")) totals.push("auras");
  if (subtypes.has("Vehicle")) totals.push("vehicles");
  if (types.has("Planeswalker")) totals.push("planeswalkers");
  if (types.has("Battle")) totals.push("battles");
  if (supertypes.has("Legendary")) {
    totals.push("legendaryPermanents");
  }
  if (object.isToken) totals.push("tokens");
  if (!object.isToken) totals.push("nontokenPermanents");
  if (object.isToken && subtypes.has("Treasure")) totals.push("treasureTokens");
  if (object.isToken && subtypes.has("Clue")) totals.push("clueTokens");
  if (object.isToken && subtypes.has("Food")) totals.push("foodTokens");
  if (object.isToken && subtypes.has("Blood")) totals.push("bloodTokens");
  if (object.isToken && subtypes.has("Map")) totals.push("mapTokens");
  if (subtypes.has("Powerstone")) totals.push("powerstones");
  return sortStrings([...new Set(totals)]) as RelevantTotalKey[];
}

function relevantTotalsForText(text: string): RelevantTotalKey[] {
  const totals: RelevantTotalKey[] = [];
  if (text.includes("artifact")) totals.push("artifacts");
  if (text.includes("equipment")) totals.push("equipment");
  if (text.includes("creature")) totals.push("creatures");
  if (text.includes("enchantment")) totals.push("enchantments");
  if (text.includes("land")) totals.push("lands");
  if (text.includes("token")) totals.push("tokens");
  if (text.includes("graveyard")) totals.push("cardsInGraveyard");
  if (text.includes("exile")) totals.push("cardsInExile");
  if (text.includes("hand")) totals.push("cardsInHand");
  return sortStrings([...new Set(totals)]) as RelevantTotalKey[];
}

function eventCategoriesForText(text: string): AthenaEventCategory[] {
  const events: AthenaEventCategory[] = [];
  if (text.includes("landfall") || text.includes("land enters")) {
    events.push("land-entered");
  }
  if (text.includes("creature enters") || text.includes("creatures enter")) {
    events.push("creature-entered");
  }
  if (text.includes("enters the battlefield")) {
    events.push("permanent-entered");
  }
  if (text.includes("token")) events.push("token-created");
  if (text.includes("counter")) events.push("counter-placed");
  if (text.includes("gain") && text.includes("life"))
    events.push("life-gained");
  if (text.includes("lose") && text.includes("life")) events.push("life-lost");
  if (text.includes("attack")) events.push("attack-declared");
  return sortStrings([...new Set(events)]) as AthenaEventCategory[];
}

function replacementEventsForText(text: string): AthenaEventCategory[] {
  if (!text.includes("if an effect would")) return [];
  const events: AthenaEventCategory[] = [];
  if (text.includes("token")) events.push("token-created");
  if (text.includes("counter")) events.push("counter-placed");
  return sortStrings(events) as AthenaEventCategory[];
}

function tokenDefinitionsForText(
  object: AthenaBattlefieldObject,
  text: string,
): TokenDefinition[] {
  if (!text.includes("create")) return [];
  if (text.includes("gnome")) {
    return [
      {
        id: `${object.groupId}:oracle-gnome`,
        name: "Gnome",
        power: 1,
        toughness: 1,
        cardTypes: ["Artifact", "Creature"],
        subtypes: ["Gnome"],
      },
    ];
  }
  if (text.includes("beast")) {
    return [
      {
        id: `${object.groupId}:oracle-beast`,
        name: "Beast",
        power: 4,
        toughness: 4,
        cardTypes: ["Creature"],
        subtypes: ["Beast"],
      },
    ];
  }
  return [];
}

function counterDefinitionsForText(
  object: AthenaBattlefieldObject,
  text: string,
): CounterDefinition[] {
  if (!text.includes("counter")) return [];
  return [
    {
      id: `${object.groupId}:oracle-counter`,
      name: text.includes("+1/+1") ? "+1/+1" : "counter",
      target: text.includes("each creature") ? "creatures" : "self",
    },
  ];
}

function eventCategoryForCustomTrigger(
  trigger: CustomEffect["trigger"],
): AthenaEventCategory {
  if (trigger === "activate-field") return "trigger-announced";
  return trigger;
}

function totalsReadByValueExpression(
  value: CustomEffect["action"]["amount"],
): RelevantTotalKey[] {
  if (value.type === "total") return [value.key];
  return [];
}

function customEffectTarget(effect: CustomEffect): DefinitionTarget {
  if (effect.action.kind === "add-counters") {
    return effect.action.target === "all-creatures" ? "creatures" : "none";
  }
  if (effect.action.kind === "life") return "players";
  return "none";
}

function customEffectSourceGroupId(effect: CustomEffect): string | null {
  const sourceGroupId = (effect as { sourceGroupId?: unknown }).sourceGroupId;
  return typeof sourceGroupId === "string" ? sourceGroupId : null;
}

function tokenDefinitionIdForObject(object: AthenaBattlefieldObject): string {
  return `${object.cardId ?? object.groupId}:${object.identityName ?? object.label}:${object.basePower ?? "x"}/${object.baseToughness ?? "x"}:${object.subtypes.join(".")}`;
}

function attachmentType(object: AthenaBattlefieldObject): string {
  if (object.subtypes.includes("Equipment")) return "equipment";
  if (object.subtypes.includes("Aura")) return "aura";
  return "attachment";
}

function relationshipId(
  relationship: Omit<
    AthenaGraphRelationship,
    | "id"
    | "fieldId"
    | "sessionId"
    | "authoritySource"
    | "authorityPrecedence"
    | "definitionVersion"
  >,
): string {
  return [
    "athena-rel2",
    relationship.type,
    relationship.from,
    relationship.to,
    relationship.sourceGroupId ?? "none",
    relationship.eventCategories.join(".") || "no-event",
    relationship.relevantTotals.join(".") || "no-total",
    normalizeIdPart(relationship.label),
  ].join(":");
}

function objectNodeId(groupId: string): string {
  return `athena-node:object:${groupId}`;
}

function totalNodeId(total: RelevantTotalKey): string {
  return `athena-node:total:${total}`;
}

function zoneNodeId(zone: Zone): string {
  return `athena-node:zone:${zone}`;
}

function eventNodeId(eventCategory: AthenaEventCategory): string {
  return `athena-node:event:${eventCategory}`;
}

function playerStateNodeId(key: string): string {
  return `athena-node:player:${key}`;
}

function effectNodeId(definitionId: string): string {
  return `athena-node:effect:${definitionId}`;
}

function tokenDefinitionNodeId(definitionId: string): string {
  return `athena-node:token-definition:${normalizeIdPart(definitionId)}`;
}

function counterDefinitionNodeId(counterName: string): string {
  return `athena-node:counter-definition:${normalizeIdPart(counterName)}`;
}

function authorityNodeId(key: string): string {
  return `athena-node:authority:${normalizeIdPart(key)}`;
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
    index[key] = sortStrings(value);
  }
}

function sortNodes(nodes: AthenaGraphNode[]): AthenaGraphNode[] {
  return nodes.sort((a, b) => a.id.localeCompare(b.id));
}

function sortRelationships(
  relationships: AthenaGraphRelationship[],
): AthenaGraphRelationship[] {
  return relationships.sort((a, b) => a.id.localeCompare(b.id));
}

function uniqueRelationships(
  relationships: AthenaGraphRelationship[],
): AthenaGraphRelationship[] {
  const byId = new Map<string, AthenaGraphRelationship>();
  for (const relationship of relationships)
    byId.set(relationship.id, relationship);
  return sortRelationships([...byId.values()]);
}

function sortStrings<T extends string>(values: T[]): T[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function normalizeIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:+/.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function fingerprintValue(value: unknown): string {
  return serializeStable(value);
}

function fingerprintGraphInput(
  context: AthenaAwarenessContext,
  field: FieldState | null,
): string {
  return fingerprintValue({
    version: ATHENA_DEPENDENCY_GRAPH_VERSION,
    contextVersion: ATHENA_CONTEXT_VERSION,
    fieldId: context.fieldId,
    sessionId: context.sessionId,
    authoritySource: context.currentAuthoritySource,
    battlefield: context.battlefield.map((object) => ({
      groupId: object.groupId,
      objectIds: object.objectIds,
      label: object.label,
      quantity: object.quantity,
      zone: object.zone,
      identityName: object.identityName,
      cardId: object.cardId,
      originalCardId: object.originalCardId,
      supportStatus: object.supportStatus,
      cardTypes: object.cardTypes,
      supertypes: object.supertypes,
      subtypes: object.subtypes,
      isGeneric: object.isGeneric,
      isToken: object.isToken,
      trackingEnabled: object.trackingEnabled,
      abilitiesActive: object.abilitiesActive,
      depowerMode: object.depowerMode,
      counters: object.counters,
      statuses: object.statuses,
      attachedTo: object.attachedTo,
      attachments: object.attachments,
      stackKey: object.stackKey,
    })),
    player: field?.player ?? null,
    customEffects: field?.customEffects ?? [],
    totals: calculateTotals(field?.groups ?? []),
  });
}

function graphIdentity(graph: AthenaDependencyGraph): string {
  return fingerprintValue({
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      fingerprint: node.fingerprint,
    })),
    relationships: graph.relationships.map((relationship) => ({
      id: relationship.id,
      enabled: relationship.enabled,
      disabledReason: relationship.disabledReason,
      authoritySource: relationship.authoritySource,
      support: relationship.support,
    })),
  });
}

function detectRelationshipCycles(
  nodes: AthenaGraphNode[],
  relationships: AthenaGraphRelationship[],
): string[][] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  for (const relationship of relationships) {
    if (!nodeIds.has(relationship.from) || !nodeIds.has(relationship.to))
      continue;
    const next = adjacency.get(relationship.from) ?? [];
    next.push(relationship.to);
    adjacency.set(relationship.from, sortStrings(next));
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function visit(nodeId: string): void {
    if (stack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      if (cycleStart >= 0) cycles.push(path.slice(cycleStart).concat(nodeId));
      return;
    }
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    stack.add(nodeId);
    path.push(nodeId);
    for (const nextId of adjacency.get(nodeId) ?? []) visit(nextId);
    path.pop();
    stack.delete(nodeId);
  }

  for (const node of nodes) visit(node.id);
  return cycles;
}

function performanceNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}
