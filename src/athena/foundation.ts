import { makeId } from "../domain/cards";
import { calculateTotals } from "../domain/field";
import type {
  FieldState,
  GameEvent,
  GameEventType,
  PermanentGroup,
  RelevantTotalKey,
  ResolutionResult,
  SupportStatus,
  Zone,
} from "../domain/types";
import { getActiveListeningWindow } from "../echo/contextualListening";
import { monotonicNowMs } from "../platform/runtime";
import { localParticipantId } from "../sharedSession";
import {
  ATHENA_COMPATIBILITY_VERSION,
  ATHENA_CONTEXT_VERSION,
  ATHENA_FOUNDATION_VERSION,
  ATHENA_PREVIEW_VERSION,
  type AthenaActiveHelperDefinition,
  type AthenaAttachmentLink,
  type AthenaAuthorityComparison,
  type AthenaAuthorityPrecedence,
  type AthenaAuthoritySource,
  type AthenaAwarenessContext,
  type AthenaAwarenessContextOptions,
  type AthenaBattlefieldObject,
  type AthenaChoiceRequirement,
  type AthenaCounterSummary,
  type AthenaDiagnostics,
  type AthenaPreviewInput,
  type AthenaPreviewLifecycleRecord,
  type AthenaPreviewState,
  type AthenaPreviewStatus,
  type AthenaRelationship,
  type AthenaRelationshipKind,
  type AthenaSettings,
  type AthenaSourceUnavailableReason,
  type AthenaState,
  type AthenaSupportFinding,
  type AthenaSupportFindingStatus,
  type AthenaZoneQuantitySnapshot,
} from "./types";

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const RESTORABLE_PREVIEW_STATUSES: AthenaPreviewStatus[] = [
  "ready",
  "awaiting-choice",
  "awaiting-confirmation",
];
const ZONES: Zone[] = [
  "battlefield",
  "hand",
  "graveyard",
  "exile",
  "library",
  "command",
];
const SUPPORT_STATUSES: SupportStatus[] = [
  "fully-automated",
  "partially-automated",
  "quantity-tracking-only",
  "unsupported",
];

export function createDefaultAthenaSettings(
  input: Partial<AthenaSettings> = {},
): AthenaSettings {
  return {
    version: ATHENA_FOUNDATION_VERSION,
    enabled: input.enabled ?? true,
    awarenessContextEnabled: input.awarenessContextEnabled ?? true,
    previewMetadataPersistence:
      input.previewMetadataPersistence === "none" ? "none" : "metadata-only",
    maxRelationships: clampInteger(input.maxRelationships, 0, 500, 120),
    maxRecentHistory: clampInteger(input.maxRecentHistory, 0, 100, 20),
    developerDiagnosticsEnabled: Boolean(input.developerDiagnosticsEnabled),
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    localOnly: true,
    boardStateAuthorityConnected: false,
    directBattlefieldMutation: false,
    duplicateBattlefieldState: false,
    duplicateEventHistory: false,
    duplicateUndoStack: false,
    rulesAuthorityTransferred: false,
    lastResetAt:
      typeof input.lastResetAt === "string" ? input.lastResetAt : null,
  };
}

export function normalizeAthenaSettings(value: unknown): AthenaSettings {
  const defaults = createDefaultAthenaSettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<AthenaSettings>;
  return createDefaultAthenaSettings({
    enabled:
      candidate.enabled === undefined
        ? defaults.enabled
        : Boolean(candidate.enabled),
    awarenessContextEnabled:
      candidate.awarenessContextEnabled === undefined
        ? defaults.awarenessContextEnabled
        : Boolean(candidate.awarenessContextEnabled),
    previewMetadataPersistence:
      candidate.previewMetadataPersistence === "none"
        ? "none"
        : "metadata-only",
    maxRelationships: candidate.maxRelationships,
    maxRecentHistory: candidate.maxRecentHistory,
    developerDiagnosticsEnabled: candidate.developerDiagnosticsEnabled,
    lastResetAt: candidate.lastResetAt,
  });
}

export function createDefaultAthenaState(
  input: Partial<AthenaState> = {},
): AthenaState {
  const activePreview = input.activePreview ?? null;
  const lastContext = normalizeLastContext(input.lastContext);
  return {
    version: ATHENA_FOUNDATION_VERSION,
    activePreview,
    recentPreviewIds: Array.isArray(input.recentPreviewIds)
      ? uniqueStrings(input.recentPreviewIds).slice(0, 20)
      : [],
    lastContext,
    diagnostics: createDiagnostics({
      ...(input.diagnostics ?? {}),
      pendingPreviewStatus: activePreview?.status ?? null,
      dependencyCount: lastContext?.dependencyCount ?? 0,
      unsupportedRelationshipCount:
        lastContext?.unsupportedRelationshipCount ?? 0,
      currentAuthoritySource:
        lastContext?.authoritySource ?? "lite-local-helper-result",
    }),
  };
}

export function normalizeAthenaState(
  value: unknown,
  options: {
    fallbackTimestamp?: string;
    settings?: AthenaSettings;
    allowActivePreview?: boolean;
  } = {},
): AthenaState {
  const timestamp = options.fallbackTimestamp ?? DEFAULT_TIMESTAMP;
  const settings = normalizeAthenaSettings(options.settings);
  if (!value || typeof value !== "object") {
    return createDefaultAthenaState({
      diagnostics: createDiagnostics({
        enabled: settings.enabled,
        developerDiagnosticsAvailable: settings.developerDiagnosticsEnabled,
      }),
    });
  }
  const candidate = value as Partial<AthenaState>;
  const activePreview = normalizeAthenaPreview(candidate.activePreview, {
    allowActivePreview:
      options.allowActivePreview !== false &&
      settings.previewMetadataPersistence === "metadata-only",
    timestamp,
  });
  const recentPreviewIds = uniqueStrings([
    ...(activePreview ? [activePreview.id] : []),
    ...(Array.isArray(candidate.recentPreviewIds)
      ? candidate.recentPreviewIds.filter(isString)
      : []),
  ]).slice(0, 20);
  const lastContext = normalizeLastContext(candidate.lastContext);
  const invalidationReason =
    candidate.activePreview && !activePreview
      ? "Unsafe or invalid Athena preview metadata was discarded."
      : candidate.diagnostics?.lastInvalidationReason;
  return createDefaultAthenaState({
    activePreview,
    recentPreviewIds,
    lastContext,
    diagnostics: createDiagnostics({
      ...(candidate.diagnostics && typeof candidate.diagnostics === "object"
        ? candidate.diagnostics
        : {}),
      enabled: settings.enabled,
      developerDiagnosticsAvailable: settings.developerDiagnosticsEnabled,
      pendingPreviewStatus: activePreview?.status ?? null,
      dependencyCount: lastContext?.dependencyCount ?? 0,
      unsupportedRelationshipCount:
        lastContext?.unsupportedRelationshipCount ?? 0,
      currentAuthoritySource:
        lastContext?.authoritySource ??
        normalizeAthenaAuthoritySource(
          candidate.diagnostics?.currentAuthoritySource,
        ),
      lastInvalidationReason: invalidationReason ?? null,
    }),
  });
}

export function resetAthenaState(
  options: { timestamp?: string } = {},
): AthenaState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return createDefaultAthenaState({
    diagnostics: createDiagnostics({
      lastInvalidationReason: `Athena state reset at ${timestamp}.`,
      lastAnalysisDurationMs: 0,
      currentAuthoritySource: "lite-local-helper-result",
      currentAuthorityPrecedence: rankAthenaAuthoritySource(
        "lite-local-helper-result",
      ),
      developerDiagnosticsAvailable: false,
      lastError: null,
      pendingPreviewStatus: null,
      enabled: true,
      currentIntegrationSource: "manual",
    }),
  });
}

export class AthenaCoordinator {
  createAwarenessContext(
    field: FieldState,
    options: AthenaAwarenessContextOptions = {},
  ): AthenaAwarenessContext {
    return createAthenaAwarenessContext(field, options);
  }

  createPreview(
    field: FieldState,
    input: AthenaPreviewInput = {},
    options: AthenaAwarenessContextOptions = {},
  ): AthenaPreviewState {
    return createAthenaPreview(createAthenaAwarenessContext(field, options), {
      ...input,
      timestamp: input.timestamp ?? options.timestamp,
    });
  }

  refreshState(
    state: AthenaState,
    field: FieldState,
    options: AthenaAwarenessContextOptions & { settings?: AthenaSettings } = {},
  ): AthenaState {
    const started = performanceNow();
    const context = createAthenaAwarenessContext(field, options);
    const duration = performanceNow() - started;
    const normalized = normalizeAthenaState(state, {
      fallbackTimestamp: context.createdAt,
      settings: options.settings,
      allowActivePreview: true,
    });
    return {
      ...normalized,
      lastContext: {
        version: ATHENA_CONTEXT_VERSION,
        fieldId: context.fieldId,
        sessionId: context.sessionId,
        fingerprint: fingerprintContext(context),
        createdAt: context.createdAt,
        dependencyCount: context.relationships.length,
        unsupportedRelationshipCount: context.supportFindings.filter(
          (finding) =>
            finding.status === "unsupported-effect" ||
            finding.status === "manual-resolution-required",
        ).length,
        authoritySource: context.currentAuthoritySource,
      },
      diagnostics: createDiagnostics({
        ...normalized.diagnostics,
        currentAuthoritySource: context.currentAuthoritySource,
        currentAuthorityPrecedence: context.authorityPrecedence,
        dependencyCount: context.relationships.length,
        supportedRelationshipCount: context.relationships.filter(
          (relationship) =>
            relationship.support === "fully-understood-consequence" ||
            relationship.support === "partially-understood-consequence",
        ).length,
        unsupportedRelationshipCount: context.supportFindings.filter(
          (finding) =>
            finding.status === "unsupported-effect" ||
            finding.status === "manual-resolution-required",
        ).length,
        pendingPreviewStatus: normalized.activePreview?.status ?? null,
        lastAnalysisDurationMs: duration,
        currentIntegrationSource: integrationSourceForContext(context),
      }),
    };
  }
}

export const athenaCoordinator = new AthenaCoordinator();

export function createAthenaAwarenessContext(
  field: FieldState,
  options: AthenaAwarenessContextOptions = {},
): AthenaAwarenessContext {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const participantId = localParticipantId(field.session);
  const authoritySource =
    options.authoritySource ??
    authoritySourceForField(field, options.pendingRulesResult ?? null);
  const authorityPrecedence = rankAthenaAuthoritySource(authoritySource);
  const settings = normalizeAthenaSettings(field.settings.athena);
  const activeWindow = getActiveListeningWindow(field.contextualListening);
  const battlefield = field.groups.map((group) =>
    battlefieldObjectFromGroup(group, field.session.id),
  );
  const relationships = buildRelationships(battlefield, authoritySource).slice(
    0,
    Math.max(0, options.maxRelationships ?? settings.maxRelationships),
  );
  const supportFindings = buildSupportFindings(battlefield);
  const activeHelperDefinitions = buildActiveHelperDefinitions(battlefield);
  const recentCanonicalEventIds = uniqueStrings(
    options.recentCanonicalEventIds ?? [],
  ).slice(0, settings.maxRecentHistory);
  const pendingRulesResult = pendingRulesResultContext(
    options.pendingRulesResult ?? null,
  );
  const pendingEvent = pendingEventContext(options.pendingEvent ?? null);
  const currentPlannerActionIds = field.preTurnPlanner.actions
    .filter((action) => action.status === "planned")
    .map((action) => action.id);
  const currentActionStripItemIds = field.activeTurnActionStrip.items
    .filter((item) => item.status === "current" || item.status === "pending")
    .map((item) => item.id);
  const activeCombatSession = field.combatDeclaration.sessions.find(
    (session) => session.id === field.combatDeclaration.activeSessionId,
  );
  const activeGameplaySession = field.voiceBattlefieldActions.sessions.find(
    (session) => session.id === field.voiceBattlefieldActions.activeSessionId,
  );

  return {
    version: ATHENA_CONTEXT_VERSION,
    compatibilityVersion: ATHENA_COMPATIBILITY_VERSION,
    createdAt: timestamp,
    fieldId: field.id,
    sessionId: field.session.id,
    localParticipantId: participantId,
    currentRulesAuthority: field.session.currentRulesAuthority,
    currentSessionAuthority: field.session.currentSessionAuthority,
    currentAuthoritySource: authoritySource,
    authorityPrecedence,
    boardStateAuthorityAvailable:
      field.session.currentRulesAuthority === "boardstate-authority",
    mode: field.mode.currentMode,
    ambientMode: field.ambient.currentMode,
    currentPhase: field.ambient.context.observedTurn?.phase ?? null,
    currentTurn: field.ambient.context.observedTurn?.activeController ?? null,
    currentPlayer:
      field.ambient.context.observedTurn?.activeController ?? "unknown",
    currentListeningWindowId: activeWindow?.id ?? null,
    currentListeningWindowKind: activeWindow?.kind ?? null,
    currentPlannerActionIds,
    currentActionStripItemIds,
    currentCombatSessionId: activeCombatSession?.id ?? null,
    currentGameplaySessionId: activeGameplaySession?.id ?? null,
    battlefield,
    genericObjectGroupIds: battlefield
      .filter((object) => object.isGeneric)
      .map((object) => object.groupId),
    tokenStackGroupIds: battlefield
      .filter((object) => object.isToken)
      .map((object) => object.groupId),
    attachmentLinks: buildAttachmentLinks(battlefield),
    counterSummaries: battlefield
      .filter((object) => Object.keys(object.counters).length > 0)
      .map<AthenaCounterSummary>((object) => ({
        groupId: object.groupId,
        objectIds: [...object.objectIds],
        counters: { ...object.counters },
      })),
    relevantTotals: totalsSnapshot(field),
    zoneQuantities: zoneQuantitySnapshot(field.groups),
    trackingDisabledGroupIds: battlefield
      .filter((object) => !object.trackingEnabled)
      .map((object) => object.groupId),
    depoweredGroupIds: battlefield
      .filter((object) => object.depowerMode !== "none")
      .map((object) => object.groupId),
    currentStaticModifiers: relationships.filter(
      (relationship) => relationship.kind === "static-total-reader",
    ),
    currentReplacementEffects: relationships.filter(
      (relationship) => relationship.kind === "replacement-effect",
    ),
    currentEventWatchers: relationships.filter(
      (relationship) => relationship.kind === "event-watcher",
    ),
    activeHelperDefinitions,
    supportedCardStatus: supportStatusCounts(battlefield),
    supportFindings,
    relationships,
    pendingEvent,
    pendingRulesResult,
    recentCanonicalEventIds,
    recentEchoIntentId: options.recentEchoIntent?.id ?? null,
    undoBoundaryId:
      typeof options.undoBoundaryId === "string"
        ? options.undoBoundaryId
        : null,
    committedStateReadOnly: true,
    previewStateIsolated: true,
    directBattlefieldMutation: false,
    duplicateBattlefieldState: false,
    duplicateEventHistory: false,
    duplicateUndoStack: false,
  };
}

export function createAthenaPreview(
  context: AthenaAwarenessContext,
  input: AthenaPreviewInput = {},
): AthenaPreviewState {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const unsupportedFindings =
    input.unsupportedFindings ??
    context.supportFindings.filter(
      (finding) =>
        finding.status === "unsupported-effect" ||
        finding.status === "manual-resolution-required" ||
        finding.status === "authority-required",
    );
  const affectedGroupIds = uniqueStrings(
    input.affectedGroupIds ?? [
      ...(context.pendingEvent?.groupIds ?? []),
      ...context.relationships.flatMap((relationship) =>
        relationship.targetGroupIds.concat(
          relationship.sourceGroupId ? [relationship.sourceGroupId] : [],
        ),
      ),
    ],
  );
  return {
    version: ATHENA_PREVIEW_VERSION,
    id: makeId("athena-preview"),
    status: "created",
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: input.expiresAt ?? null,
    authoritySource: context.currentAuthoritySource,
    authorityPrecedence: context.authorityPrecedence,
    fieldId: context.fieldId,
    sessionId: context.sessionId,
    fieldFingerprint: fingerprintContext(context),
    pendingEventId: context.pendingEvent?.id ?? null,
    pendingRulesResultTitle: context.pendingRulesResult?.title ?? null,
    affectedGroupIds: affectedGroupIds.slice(0, 100),
    requiredChoices: input.requiredChoices ?? [],
    unsupportedFindings,
    summary:
      input.summary ??
      previewSummary(context, affectedGroupIds.length, unsupportedFindings),
    lifecycle: [
      {
        status: "created",
        reason:
          "Athena preview metadata created without mutating committed field state.",
        timestamp,
      },
    ],
    committedStateMutated: false,
    directBattlefieldMutation: false,
  };
}

export function transitionAthenaPreview(
  preview: AthenaPreviewState,
  status: AthenaPreviewStatus,
  reason: string,
  timestamp = new Date().toISOString(),
): AthenaPreviewState {
  return {
    ...preview,
    status,
    updatedAt: timestamp,
    lifecycle: [
      ...preview.lifecycle,
      {
        status,
        reason: sanitizeText(reason, "Athena preview transitioned."),
        timestamp,
      },
    ],
    committedStateMutated: false,
    directBattlefieldMutation: false,
  };
}

export function recordAthenaPreview(
  state: AthenaState,
  preview: AthenaPreviewState,
): AthenaState {
  const normalized = normalizeAthenaState(state, { allowActivePreview: true });
  return {
    ...normalized,
    activePreview: preview,
    recentPreviewIds: uniqueStrings([
      preview.id,
      ...normalized.recentPreviewIds,
    ]).slice(0, 20),
    diagnostics: createDiagnostics({
      ...normalized.diagnostics,
      currentAuthoritySource: preview.authoritySource,
      currentAuthorityPrecedence: preview.authorityPrecedence,
      pendingPreviewStatus: preview.status,
    }),
  };
}

export function clearAthenaPreview(
  state: AthenaState,
  reason: string,
): AthenaState {
  const normalized = normalizeAthenaState(state, { allowActivePreview: true });
  return {
    ...normalized,
    activePreview: null,
    diagnostics: createDiagnostics({
      ...normalized.diagnostics,
      pendingPreviewStatus: null,
      lastInvalidationReason: sanitizeText(reason, "Athena preview cleared."),
    }),
  };
}

export function getAthenaDiagnostics(
  state: AthenaState,
  context?: AthenaAwarenessContext | null,
): AthenaDiagnostics {
  const normalized = normalizeAthenaState(state);
  if (!context) return { ...normalized.diagnostics };
  return createDiagnostics({
    ...normalized.diagnostics,
    currentAuthoritySource: context.currentAuthoritySource,
    currentAuthorityPrecedence: context.authorityPrecedence,
    dependencyCount: context.relationships.length,
    supportedRelationshipCount: context.relationships.filter(
      (relationship) =>
        relationship.support === "fully-understood-consequence" ||
        relationship.support === "partially-understood-consequence",
    ).length,
    unsupportedRelationshipCount: context.supportFindings.filter(
      (finding) =>
        finding.status === "unsupported-effect" ||
        finding.status === "manual-resolution-required",
    ).length,
    currentIntegrationSource: integrationSourceForContext(context),
  });
}

export function normalizeAthenaAuthoritySource(
  value: unknown,
): AthenaAuthoritySource {
  if (
    value === "boardstate-authoritative-result" ||
    value === "confirmed-canonical-session-result" ||
    value === "confirmed-user-report" ||
    value === "lite-local-helper-result" ||
    value === "project-echo-voice-report" ||
    value === "project-echo-planned-action" ||
    value === "correction-only" ||
    value === "imported-canonical-event" ||
    value === "lite-preview"
  ) {
    return value;
  }
  return "unknown";
}

export function rankAthenaAuthoritySource(
  source: AthenaAuthoritySource,
): AthenaAuthorityPrecedence {
  if (source === "boardstate-authoritative-result") return 1;
  if (source === "confirmed-canonical-session-result") return 2;
  if (
    source === "confirmed-user-report" ||
    source === "project-echo-voice-report" ||
    source === "correction-only" ||
    source === "imported-canonical-event"
  ) {
    return 3;
  }
  if (source === "lite-local-helper-result") return 4;
  if (source === "project-echo-planned-action" || source === "lite-preview") {
    return 5;
  }
  return 6;
}

export function compareAthenaAuthoritySources(
  first: AthenaAuthoritySource,
  second: AthenaAuthoritySource,
): AthenaAuthorityComparison {
  const firstRank = rankAthenaAuthoritySource(first);
  const secondRank = rankAthenaAuthoritySource(second);
  const firstWins = firstRank <= secondRank;
  return {
    winner: firstWins ? first : second,
    loser: firstWins ? second : first,
    tied: firstRank === secondRank,
    winningPrecedence: firstWins ? firstRank : secondRank,
    losingPrecedence: firstWins ? secondRank : firstRank,
  };
}

function battlefieldObjectFromGroup(
  group: PermanentGroup,
  fallbackSessionId: string,
): AthenaBattlefieldObject {
  const objectIds = group.session?.objectIds ?? [group.id];
  const supportStatus = group.identity?.supportStatus ?? null;
  const reason = sourceUnavailableReason(group, supportStatus);
  return {
    groupId: group.id,
    sessionId: group.session?.sessionId ?? fallbackSessionId,
    primaryObjectId: group.session?.objectId ?? objectIds[0] ?? group.id,
    objectIds,
    stackKey: group.stackKey,
    label: group.label,
    quantity: group.quantity,
    zone: group.zone,
    owner: group.owner,
    controller: group.controller,
    ownerParticipantId: group.session?.ownerParticipantId ?? "local",
    controllerParticipantId: group.session?.controllerParticipantId ?? "local",
    identityName: group.identity?.name ?? null,
    cardId: group.identity?.cardId ?? null,
    oracleId: group.identity?.oracleId ?? null,
    oracleText: group.identity?.oracleText ?? null,
    originalCardId: group.originalIdentity?.cardId ?? null,
    supportStatus,
    isGeneric: group.isGeneric,
    isToken: group.characteristics.isToken,
    isCommander:
      group.characteristics.supertypes.includes("Legendary") &&
      group.characteristics.isCreature,
    isCreature: group.characteristics.isCreature,
    isAttachment:
      group.characteristics.subtypes.includes("Equipment") ||
      group.characteristics.subtypes.includes("Aura"),
    trackingEnabled: group.trackingEnabled,
    abilitiesActive: group.abilitiesActive,
    depowerMode: group.depowerMode,
    sourceUnavailableReason: reason,
    canBeEffectSource: reason === null,
    canBeEffectRecipient: group.zone === "battlefield",
    counters: { ...group.counters },
    statuses: { ...group.statuses },
    attachments: [...group.attachments],
    attachedTo: group.attachedTo,
    basePower: group.pt.basePower,
    baseToughness: group.pt.baseToughness,
    currentPower: group.pt.currentPower,
    currentToughness: group.pt.currentToughness,
    cardTypes: [...group.characteristics.cardTypes],
    supertypes: [...group.characteristics.supertypes],
    subtypes: [...group.characteristics.subtypes],
    lineage: {
      transformed: group.statuses.transformed,
      originalName: group.originalIdentity?.name ?? null,
      originalCardId: group.originalIdentity?.cardId ?? null,
      objectIds,
    },
  };
}

function sourceUnavailableReason(
  group: PermanentGroup,
  supportStatus: SupportStatus | null,
): AthenaSourceUnavailableReason {
  if (group.zone !== "battlefield") return "zone-not-battlefield";
  if (group.trackingEnabled === false) return "not-tracked";
  if (group.isGeneric) return "generic-placeholder";
  if (
    !group.abilitiesActive ||
    group.depowerMode === "all" ||
    group.depowerMode === "triggered"
  ) {
    return "depowered";
  }
  if (!group.identity) return "missing-identity";
  if (supportStatus === "quantity-tracking-only") return "quantity-only";
  if (supportStatus === "unsupported") return "unsupported-effect";
  return null;
}

function buildRelationships(
  objects: AthenaBattlefieldObject[],
  authoritySource: AthenaAuthoritySource,
): AthenaRelationship[] {
  const relationships: AthenaRelationship[] = [];
  for (const object of objects) {
    if (!object.trackingEnabled) {
      relationships.push(
        relationshipForObject(
          "tracking-disabled",
          object,
          [object],
          [],
          [],
          "manual-resolution-required",
          authoritySource,
          false,
          "Tracking is disabled; object remains present but cannot act as an effect source.",
        ),
      );
    }
    if (object.depowerMode !== "none" || !object.abilitiesActive) {
      relationships.push(
        relationshipForObject(
          "depowered-source",
          object,
          [object],
          [],
          [],
          "manual-resolution-required",
          authoritySource,
          false,
          "Depowered abilities are distinct from Not Tracked and are unavailable as local helper sources.",
        ),
      );
    }
    if (object.isGeneric) {
      relationships.push(
        relationshipForObject(
          "total-contributor",
          object,
          [object],
          [],
          relevantTotalsForObject(object),
          "fully-understood-consequence",
          authoritySource,
          false,
          "Generic placeholder contributes to totals and may receive effects, but is not an ability source.",
        ),
      );
    }
    if (object.attachedTo) {
      const host = objects.find((entry) => entry.groupId === object.attachedTo);
      relationships.push(
        relationshipForObject(
          "attachment-modifier",
          object,
          host ? [host] : [],
          [],
          [],
          host
            ? "partially-understood-consequence"
            : "manual-resolution-required",
          authoritySource,
          object.canBeEffectSource,
          host
            ? "Attachment relationship preserved for future static-effect awareness."
            : "Attachment host reference is stale or missing.",
        ),
      );
    }
    if (object.lineage.transformed) {
      relationships.push(
        relationshipForObject(
          "transformed-lineage",
          object,
          [object],
          [],
          [],
          "fully-understood-consequence",
          authoritySource,
          false,
          "Transformed object retains identity continuity through the same object identifiers.",
        ),
      );
    }
    if (object.quantity > 1) {
      relationships.push(
        relationshipForObject(
          "stack-lineage",
          object,
          [object],
          [],
          [],
          "fully-understood-consequence",
          authoritySource,
          false,
          "Grouped stack preserves per-object lineage through stable object identifiers.",
        ),
      );
    }
    if (object.canBeEffectSource) {
      relationships.push(
        ...sourceRelationships(object, objects, authoritySource),
      );
    }
  }
  return relationships;
}

function sourceRelationships(
  object: AthenaBattlefieldObject,
  objects: AthenaBattlefieldObject[],
  authoritySource: AthenaAuthoritySource,
): AthenaRelationship[] {
  const text = oracleTextForAwareness(object).toLowerCase();
  const relationships: AthenaRelationship[] = [];
  const eventTypes = eventTypesForOracle(text);
  if (eventTypes.length > 0) {
    relationships.push(
      relationshipForObject(
        "event-watcher",
        object,
        objects.filter((entry) => entry.zone === "battlefield"),
        eventTypes,
        relevantTotalsForOracle(text),
        supportForObject(object),
        authoritySource,
        true,
        `${object.label} watches supported event categories for future Athena consequence analysis.`,
      ),
    );
  }
  if (text.includes("if an effect would")) {
    relationships.push(
      relationshipForObject(
        "replacement-effect",
        object,
        objects.filter((entry) => entry.zone === "battlefield"),
        eventTypesForReplacement(text),
        [],
        supportForObject(object),
        authoritySource,
        true,
        `${object.label} has a replacement-effect boundary that future Athena analysis can consult.`,
      ),
    );
  }
  if (text.includes("creatures you control get") || text.includes("gets +")) {
    relationships.push(
      relationshipForObject(
        "static-total-reader",
        object,
        objects.filter((entry) => entry.isCreature),
        [],
        ["creatures"],
        supportForObject(object),
        authoritySource,
        true,
        `${object.label} has a static modifier relationship prepared for future recalculation.`,
      ),
    );
  }
  return relationships;
}

function relationshipForObject(
  kind: AthenaRelationshipKind,
  source: AthenaBattlefieldObject,
  targets: AthenaBattlefieldObject[],
  eventTypes: GameEventType[],
  relevantTotals: RelevantTotalKey[],
  support: AthenaSupportFindingStatus,
  authoritySource: AthenaAuthoritySource,
  sourceAvailable: boolean,
  description: string,
): AthenaRelationship {
  return {
    id: `athena-rel:${kind}:${source.groupId}:${targets
      .map((target) => target.groupId)
      .join(".")}`,
    kind,
    sourceGroupId: source.groupId,
    sourceObjectIds: [...source.objectIds],
    targetGroupIds: targets.map((target) => target.groupId),
    targetObjectIds: targets.flatMap((target) => target.objectIds),
    eventTypes,
    relevantTotals,
    support,
    authoritySource,
    authorityPrecedence: rankAthenaAuthoritySource(authoritySource),
    sourceAvailable,
    unsupportedReason: source.sourceUnavailableReason,
    description,
  };
}

function buildSupportFindings(
  objects: AthenaBattlefieldObject[],
): AthenaSupportFinding[] {
  return objects
    .map((object) => supportFindingForObject(object))
    .filter((finding): finding is AthenaSupportFinding => Boolean(finding));
}

function supportFindingForObject(
  object: AthenaBattlefieldObject,
): AthenaSupportFinding | null {
  if (object.isGeneric) {
    return {
      id: `athena-support:${object.groupId}`,
      status: "fully-understood-consequence",
      groupId: object.groupId,
      objectIds: [...object.objectIds],
      label: object.label,
      supportStatus: null,
      authorityRequired: false,
      manualResolutionRequired: false,
      message:
        "Generic placeholder is available as an effect recipient and total contributor only.",
    };
  }
  if (!object.supportStatus) return null;
  const status = supportFindingStatusForSupport(object.supportStatus);
  return {
    id: `athena-support:${object.groupId}`,
    status,
    groupId: object.groupId,
    objectIds: [...object.objectIds],
    label: object.label,
    supportStatus: object.supportStatus,
    authorityRequired:
      status === "authority-required" || status === "unsupported-effect",
    manualResolutionRequired:
      status === "manual-resolution-required" ||
      status === "unsupported-effect",
    message: supportMessage(object.label, object.supportStatus, status),
  };
}

function supportFindingStatusForSupport(
  supportStatus: SupportStatus,
): AthenaSupportFindingStatus {
  if (supportStatus === "fully-automated")
    return "fully-understood-consequence";
  if (supportStatus === "partially-automated")
    return "partially-understood-consequence";
  if (supportStatus === "quantity-tracking-only")
    return "manual-resolution-required";
  return "unsupported-effect";
}

function supportForObject(
  object: AthenaBattlefieldObject,
): AthenaSupportFindingStatus {
  return object.supportStatus
    ? supportFindingStatusForSupport(object.supportStatus)
    : "manual-resolution-required";
}

function supportMessage(
  label: string,
  supportStatus: SupportStatus,
  finding: AthenaSupportFindingStatus,
): string {
  if (finding === "fully-understood-consequence") {
    return `${label} is within Lite's current supported helper boundary.`;
  }
  if (finding === "partially-understood-consequence") {
    return `${label} is partially supported and may require manual choices or future authority.`;
  }
  if (supportStatus === "quantity-tracking-only") {
    return `${label} is tracked for quantities and identity, not local helper abilities.`;
  }
  return `${label} has unsupported text and requires manual resolution or BoardState authority.`;
}

function buildActiveHelperDefinitions(
  objects: AthenaBattlefieldObject[],
): AthenaActiveHelperDefinition[] {
  return objects.flatMap((object) => {
    if (
      !object.canBeEffectSource ||
      !object.identityName ||
      !object.supportStatus
    )
      return [];
    const normalized = object.identityName.toLowerCase();
    const definitions: AthenaActiveHelperDefinition[] = [];
    if (normalized.includes("anim pakal")) {
      definitions.push(
        helperDefinition(
          object,
          "anim-pakal-attack-trigger",
          ["token-created", "counter-placed"],
          "tokens",
        ),
      );
    }
    if (normalized.includes("cathars' crusade")) {
      definitions.push(
        helperDefinition(
          object,
          "cathars-crusade",
          ["creature-entered", "counter-placed"],
          "counters",
        ),
      );
    }
    if (
      normalized.includes("soul warden") ||
      normalized.includes("essence warden")
    ) {
      definitions.push(
        helperDefinition(
          object,
          `${normalized}:life`,
          ["creature-entered", "life-gained"],
          "life-change",
        ),
      );
    }
    if (normalized.includes("impact tremors")) {
      definitions.push(
        helperDefinition(
          object,
          "impact-tremors",
          ["creature-entered", "life-lost"],
          "life-change",
        ),
      );
    }
    if (normalized.includes("rampaging baloths")) {
      definitions.push(
        helperDefinition(
          object,
          "rampaging-baloths-landfall",
          ["land-entered", "token-created"],
          "tokens",
        ),
      );
    }
    if (normalized.includes("doubling season")) {
      definitions.push(
        helperDefinition(
          object,
          "doubling-season",
          ["token-created", "counter-placed"],
          "replacement",
        ),
      );
    }
    return definitions;
  });
}

function helperDefinition(
  object: AthenaBattlefieldObject,
  id: string,
  eventTypes: GameEventType[],
  produces: AthenaActiveHelperDefinition["produces"],
): AthenaActiveHelperDefinition {
  return {
    id,
    sourceGroupId: object.groupId,
    label: object.label,
    eventTypes,
    produces,
    supportStatus: object.supportStatus ?? "unsupported",
  };
}

function buildAttachmentLinks(
  objects: AthenaBattlefieldObject[],
): AthenaAttachmentLink[] {
  return objects
    .filter((object) => object.attachedTo)
    .map((object) => {
      const host = objects.find((entry) => entry.groupId === object.attachedTo);
      return {
        attachmentGroupId: object.groupId,
        hostGroupId: object.attachedTo ?? "",
        attachmentObjectIds: [...object.objectIds],
        hostObjectIds: host?.objectIds ?? [],
      };
    })
    .filter((link) => link.hostGroupId.length > 0);
}

function totalsSnapshot(
  field: FieldState,
): AthenaAwarenessContext["relevantTotals"] {
  const totals = calculateTotals(field.groups);
  return Object.entries(totals)
    .map(([key, value]) => ({
      key: key as RelevantTotalKey,
      value,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function zoneQuantitySnapshot(
  groups: PermanentGroup[],
): AthenaZoneQuantitySnapshot[] {
  return ZONES.map((zone) => {
    const matching = groups.filter((group) => group.zone === zone);
    return {
      zone,
      quantity: matching.reduce((sum, group) => sum + group.quantity, 0),
      groupCount: matching.length,
    };
  });
}

function supportStatusCounts(
  objects: AthenaBattlefieldObject[],
): Record<SupportStatus, number> {
  const counts: Record<SupportStatus, number> = {
    "fully-automated": 0,
    "partially-automated": 0,
    "quantity-tracking-only": 0,
    unsupported: 0,
  };
  for (const object of objects) {
    if (object.supportStatus) counts[object.supportStatus] += 1;
  }
  return counts;
}

function oracleTextForAwareness(object: AthenaBattlefieldObject): string {
  return object.oracleText ?? "";
}

function eventTypesForOracle(text: string): GameEventType[] {
  const events: GameEventType[] = [];
  if (text.includes("landfall") || text.includes("land enters")) {
    events.push("land-entered");
  }
  if (
    text.includes("creature enters") ||
    text.includes("creatures enter") ||
    text.includes("enters the battlefield")
  ) {
    events.push("creature-entered", "permanent-entered");
  }
  if (text.includes("attack")) events.push("permanent-tapped");
  if (text.includes("token")) events.push("token-created");
  if (text.includes("counter")) events.push("counter-placed");
  if (text.includes("life")) events.push("life-gained", "life-lost");
  return uniqueStrings(events);
}

function eventTypesForReplacement(text: string): GameEventType[] {
  const events: GameEventType[] = [];
  if (text.includes("token")) events.push("token-created");
  if (text.includes("counter")) events.push("counter-placed");
  return uniqueStrings(events);
}

function relevantTotalsForOracle(text: string): RelevantTotalKey[] {
  const totals: RelevantTotalKey[] = [];
  if (text.includes("creature")) totals.push("creatures");
  if (text.includes("artifact")) totals.push("artifacts");
  if (text.includes("enchantment")) totals.push("enchantments");
  if (text.includes("land")) totals.push("lands");
  return uniqueStrings(totals);
}

function relevantTotalsForObject(
  object: AthenaBattlefieldObject,
): RelevantTotalKey[] {
  const totals: RelevantTotalKey[] = [];
  if (object.cardTypes.includes("Creature")) totals.push("creatures");
  if (object.cardTypes.includes("Artifact")) totals.push("artifacts");
  if (object.cardTypes.includes("Enchantment")) totals.push("enchantments");
  if (object.cardTypes.includes("Land")) totals.push("lands");
  if (object.cardTypes.includes("Planeswalker")) totals.push("planeswalkers");
  if (object.cardTypes.includes("Battle")) totals.push("battles");
  return uniqueStrings(totals);
}

function authoritySourceForField(
  field: FieldState,
  result: ResolutionResult | null,
): AthenaAuthoritySource {
  if (result?.rendering?.source === "boardstate-authority") {
    return "boardstate-authoritative-result";
  }
  if (result?.rendering?.source === "lite-helper") {
    return "lite-local-helper-result";
  }
  if (field.session.currentRulesAuthority === "boardstate-authority") {
    return "boardstate-authoritative-result";
  }
  if (field.session.currentSessionAuthority === "boardstate-authority") {
    return "confirmed-canonical-session-result";
  }
  return "lite-local-helper-result";
}

function pendingEventContext(
  event: GameEvent | null,
): AthenaAwarenessContext["pendingEvent"] {
  if (!event) return null;
  return {
    id: event.id,
    type: event.type,
    sourceId: event.sourceId,
    quantity: event.quantity,
    batchId: event.batchId,
    groupIds: [...event.groupIds],
  };
}

function pendingRulesResultContext(
  result: ResolutionResult | null,
): AthenaAwarenessContext["pendingRulesResult"] {
  if (!result) return null;
  return {
    title: result.title,
    source:
      result.rendering?.source === "boardstate-authority"
        ? "boardstate-authoritative-result"
        : "lite-local-helper-result",
    validationStatus: result.rendering?.validationStatus ?? null,
    eventIds: result.events.map((event) => event.id),
    changedGroupIds: [...result.changedGroupIds],
    unsupportedInteractions: result.rendering?.unsupportedInteractions ?? [],
  };
}

function normalizeAthenaPreview(
  value: unknown,
  options: { allowActivePreview: boolean; timestamp: string },
): AthenaPreviewState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AthenaPreviewState>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.fieldId !== "string" ||
    typeof candidate.sessionId !== "string" ||
    typeof candidate.fieldFingerprint !== "string"
  ) {
    return null;
  }
  const status = normalizePreviewStatus(candidate.status);
  if (
    !options.allowActivePreview ||
    !RESTORABLE_PREVIEW_STATUSES.includes(status)
  ) {
    return null;
  }
  const authoritySource = normalizeAthenaAuthoritySource(
    candidate.authoritySource,
  );
  return {
    version: ATHENA_PREVIEW_VERSION,
    id: candidate.id,
    status,
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : options.timestamp,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : options.timestamp,
    expiresAt:
      typeof candidate.expiresAt === "string" ? candidate.expiresAt : null,
    authoritySource,
    authorityPrecedence: rankAthenaAuthoritySource(authoritySource),
    fieldId: candidate.fieldId,
    sessionId: candidate.sessionId,
    fieldFingerprint: candidate.fieldFingerprint,
    pendingEventId:
      typeof candidate.pendingEventId === "string"
        ? candidate.pendingEventId
        : null,
    pendingRulesResultTitle:
      typeof candidate.pendingRulesResultTitle === "string"
        ? candidate.pendingRulesResultTitle
        : null,
    affectedGroupIds: Array.isArray(candidate.affectedGroupIds)
      ? uniqueStrings(candidate.affectedGroupIds.filter(isString)).slice(0, 100)
      : [],
    requiredChoices: Array.isArray(candidate.requiredChoices)
      ? candidate.requiredChoices.map(normalizeChoiceRequirement).slice(0, 50)
      : [],
    unsupportedFindings: Array.isArray(candidate.unsupportedFindings)
      ? candidate.unsupportedFindings
          .map(normalizeSupportFinding)
          .filter((entry): entry is AthenaSupportFinding => Boolean(entry))
          .slice(0, 100)
      : [],
    summary: Array.isArray(candidate.summary)
      ? candidate.summary.filter(isString).slice(0, 20)
      : [],
    lifecycle: Array.isArray(candidate.lifecycle)
      ? candidate.lifecycle.map((entry) =>
          normalizePreviewLifecycle(entry, options.timestamp),
        )
      : [
          {
            status,
            reason: "Preview restored from safe metadata.",
            timestamp: options.timestamp,
          },
        ],
    committedStateMutated: false,
    directBattlefieldMutation: false,
  };
}

function normalizeChoiceRequirement(value: unknown): AthenaChoiceRequirement {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<AthenaChoiceRequirement>)
      : {};
  return {
    id: typeof candidate.id === "string" ? candidate.id : makeId("choice"),
    kind:
      candidate.kind === "quantity-choice" ||
      candidate.kind === "player-choice" ||
      candidate.kind === "replacement-choice" ||
      candidate.kind === "trigger-order-choice" ||
      candidate.kind === "manual-resolution"
        ? candidate.kind
        : "object-choice",
    prompt: sanitizeText(candidate.prompt, "Athena choice required."),
    sourceGroupId:
      typeof candidate.sourceGroupId === "string"
        ? candidate.sourceGroupId
        : null,
    candidateGroupIds: Array.isArray(candidate.candidateGroupIds)
      ? uniqueStrings(candidate.candidateGroupIds.filter(isString)).slice(0, 50)
      : [],
    requiredBeforeCommit: candidate.requiredBeforeCommit !== false,
  };
}

function normalizeSupportFinding(value: unknown): AthenaSupportFinding | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AthenaSupportFinding>;
  if (typeof candidate.id !== "string" || typeof candidate.label !== "string") {
    return null;
  }
  return {
    id: candidate.id,
    status: normalizeSupportFindingStatus(candidate.status),
    groupId: typeof candidate.groupId === "string" ? candidate.groupId : null,
    objectIds: Array.isArray(candidate.objectIds)
      ? uniqueStrings(candidate.objectIds.filter(isString)).slice(0, 100)
      : [],
    label: sanitizeText(candidate.label, "Unknown"),
    supportStatus: normalizeSupportStatus(candidate.supportStatus),
    authorityRequired: Boolean(candidate.authorityRequired),
    manualResolutionRequired: Boolean(candidate.manualResolutionRequired),
    message: sanitizeText(candidate.message, "Athena support finding."),
  };
}

function normalizePreviewLifecycle(
  value: unknown,
  timestamp: string,
): AthenaPreviewLifecycleRecord {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<AthenaPreviewLifecycleRecord>)
      : {};
  return {
    status: normalizePreviewStatus(candidate.status),
    reason: sanitizeText(candidate.reason, "Preview lifecycle normalized."),
    timestamp:
      typeof candidate.timestamp === "string" ? candidate.timestamp : timestamp,
  };
}

function normalizeLastContext(value: unknown): AthenaState["lastContext"] {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<NonNullable<AthenaState["lastContext"]>>;
  if (
    typeof candidate.fieldId !== "string" ||
    typeof candidate.sessionId !== "string" ||
    typeof candidate.fingerprint !== "string"
  ) {
    return null;
  }
  const authoritySource = normalizeAthenaAuthoritySource(
    candidate.authoritySource,
  );
  return {
    version: ATHENA_CONTEXT_VERSION,
    fieldId: candidate.fieldId,
    sessionId: candidate.sessionId,
    fingerprint: candidate.fingerprint,
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : DEFAULT_TIMESTAMP,
    dependencyCount: clampInteger(candidate.dependencyCount, 0, 99999, 0),
    unsupportedRelationshipCount: clampInteger(
      candidate.unsupportedRelationshipCount,
      0,
      99999,
      0,
    ),
    authoritySource,
  };
}

function createDiagnostics(
  input: Partial<AthenaDiagnostics>,
): AthenaDiagnostics {
  const source = normalizeAthenaAuthoritySource(
    input.currentAuthoritySource ?? "lite-local-helper-result",
  );
  return {
    version: ATHENA_FOUNDATION_VERSION,
    enabled: input.enabled ?? true,
    currentContextVersion: ATHENA_CONTEXT_VERSION,
    currentAuthoritySource: source,
    currentAuthorityPrecedence:
      input.currentAuthorityPrecedence ?? rankAthenaAuthoritySource(source),
    dependencyCount: clampInteger(input.dependencyCount, 0, 99999, 0),
    supportedRelationshipCount: clampInteger(
      input.supportedRelationshipCount,
      0,
      99999,
      0,
    ),
    unsupportedRelationshipCount: clampInteger(
      input.unsupportedRelationshipCount,
      0,
      99999,
      0,
    ),
    pendingPreviewStatus: input.pendingPreviewStatus ?? null,
    lastAnalysisDurationMs: clampNumber(
      input.lastAnalysisDurationMs,
      0,
      60000,
      0,
    ),
    lastInvalidationReason:
      typeof input.lastInvalidationReason === "string"
        ? input.lastInvalidationReason
        : null,
    lastError: typeof input.lastError === "string" ? input.lastError : null,
    currentIntegrationSource: input.currentIntegrationSource ?? "unknown",
    developerDiagnosticsAvailable: input.developerDiagnosticsAvailable ?? false,
    localOnly: true,
    boardStateAuthorityConnected: false,
    directBattlefieldMutation: false,
    duplicateBattlefieldState: false,
    duplicateEventHistory: false,
    duplicateUndoStack: false,
    rulesAuthorityTransferred: false,
  };
}

function normalizePreviewStatus(value: unknown): AthenaPreviewStatus {
  if (
    value === "calculating" ||
    value === "ready" ||
    value === "awaiting-choice" ||
    value === "awaiting-confirmation" ||
    value === "invalidated" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "committed" ||
    value === "cancelled" ||
    value === "expired"
  ) {
    return value;
  }
  return "created";
}

function normalizeSupportFindingStatus(
  value: unknown,
): AthenaSupportFindingStatus {
  if (
    value === "partially-understood-consequence" ||
    value === "missing-choice" ||
    value === "missing-opponent-value" ||
    value === "unsupported-effect" ||
    value === "authority-required" ||
    value === "manual-resolution-required"
  ) {
    return value;
  }
  return "fully-understood-consequence";
}

function normalizeSupportStatus(value: unknown): SupportStatus | null {
  return SUPPORT_STATUSES.includes(value as SupportStatus)
    ? (value as SupportStatus)
    : null;
}

function integrationSourceForContext(
  context: AthenaAwarenessContext,
): AthenaDiagnostics["currentIntegrationSource"] {
  if (context.currentAuthoritySource === "boardstate-authoritative-result") {
    return "boardstate-authority";
  }
  if (context.pendingRulesResult?.source === "lite-local-helper-result") {
    return "lite-helper";
  }
  if (context.recentEchoIntentId) return "project-echo";
  if (context.pendingRulesResult) return "rules-result";
  if (context.pendingEvent) return "manual";
  return "unknown";
}

function fingerprintContext(context: AthenaAwarenessContext): string {
  return [
    context.fieldId,
    context.sessionId,
    context.battlefield.length,
    context.battlefield
      .map(
        (object) =>
          `${object.groupId}:${object.objectIds.join(".")}:${object.quantity}`,
      )
      .join("|"),
    context.relevantTotals
      .map((total) => `${total.key}:${total.value}`)
      .join("|"),
    context.currentAuthoritySource,
  ].join("::");
}

function previewSummary(
  context: AthenaAwarenessContext,
  affectedCount: number,
  unsupportedFindings: AthenaSupportFinding[],
): string[] {
  const summary = [
    `Athena awareness prepared ${context.relationships.length} relationship(s) for ${affectedCount} affected group(s).`,
  ];
  if (unsupportedFindings.length > 0) {
    summary.push(
      `${unsupportedFindings.length} unsupported or manual-resolution finding(s) remain isolated from committed state.`,
    );
  }
  return summary;
}

function sanitizeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return (
    value
      .replace(/[<>{}`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240) || fallback
  );
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric)
    ? Math.min(max, Math.max(min, numeric))
    : fallback;
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return Math.round(clampNumber(value, min, max, fallback));
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function performanceNow(): number {
  return monotonicNowMs();
}
