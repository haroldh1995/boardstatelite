import { createDisabledSessionCapabilities } from "../sharedSession/capabilities";
import { createParticipantId, localParticipantId } from "../sharedSession";
import type {
  SessionParticipant,
  SharedSessionMetadata,
} from "../sharedSession/types";
import type {
  BattlefieldParticipation,
  ConflictModel,
  DiscoveryModel,
  MultiplayerCompatibility,
  MultiplayerSnapshot,
  MultiplayerState,
  ParticipantRegistry,
  SynchronizationModel,
} from "./types";
import {
  MULTIPLAYER_COMPATIBILITY_VERSION,
  MULTIPLAYER_STATE_VERSION,
} from "./types";

export const MULTIPLAYER_UNAVAILABLE_REASON =
  "Mixed Lite / Advanced multiplayer requires future BoardState authority support.";

export function createDefaultMultiplayerState(
  session: SharedSessionMetadata,
  timestamp = new Date().toISOString(),
  objectIds: string[] = [],
): MultiplayerState {
  const localParticipant = createLocalMultiplayerParticipant(
    session,
    objectIds,
  );
  return {
    version: MULTIPLAYER_STATE_VERSION,
    status: "localOnly",
    applicationType: "boardstate-lite",
    registry: {
      localParticipantId: localParticipant.id,
      participants: [localParticipant],
    },
    authority: {
      current: "local-lite",
      rules: "local-lite",
      session: "local-lite",
      judge: "unknown",
    },
    capabilities: createDisabledSessionCapabilities(),
    compatibility: createCompatibility(timestamp),
    synchronization: createSynchronizationModel(),
    conflict: createConflictModel(),
    discovery: createDiscoveryModel(),
    battlefields: [
      {
        scope: "local",
        participantId: localParticipant.id,
        authority: "local-lite",
        visibility: "localOnly",
        synchronizationState: "localOnly",
      },
    ],
    updatedAt: timestamp,
  };
}

export function normalizeMultiplayerState(
  value: unknown,
  options: {
    session: SharedSessionMetadata;
    fallbackTimestamp: string;
    objectIds?: string[];
  },
): MultiplayerState {
  const defaults = createDefaultMultiplayerState(
    options.session,
    options.fallbackTimestamp,
    options.objectIds ?? [],
  );
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<MultiplayerState>;
  return {
    ...defaults,
    ...candidate,
    version:
      typeof candidate.version === "number"
        ? candidate.version
        : MULTIPLAYER_STATE_VERSION,
    status: "localOnly",
    applicationType: "boardstate-lite",
    registry: normalizeRegistry(
      candidate.registry,
      options.session,
      options.objectIds ?? [],
    ),
    authority: {
      current: "local-lite",
      rules: "local-lite",
      session: "local-lite",
      judge: "unknown",
    },
    capabilities: createDisabledSessionCapabilities(),
    compatibility: normalizeCompatibility(
      candidate.compatibility,
      options.fallbackTimestamp,
    ),
    synchronization: normalizeSynchronization(candidate.synchronization),
    conflict: normalizeConflict(candidate.conflict),
    discovery: createDiscoveryModel(),
    battlefields: normalizeBattlefields(
      candidate.battlefields,
      defaults.registry.localParticipantId,
    ),
    updatedAt: options.fallbackTimestamp,
  };
}

export function createMultiplayerSnapshot(
  multiplayer: MultiplayerState,
): MultiplayerSnapshot {
  return {
    version: multiplayer.version,
    status: multiplayer.status,
    applicationType: multiplayer.applicationType,
    registry: {
      localParticipantId: multiplayer.registry.localParticipantId,
      participants: multiplayer.registry.participants.map((participant) => ({
        ...participant,
        capabilities: { ...participant.capabilities },
        ownership: {
          ownsLocalBattlefield: participant.ownership.ownsLocalBattlefield,
          objectIds: [...participant.ownership.objectIds],
        },
      })),
    },
    authority: { ...multiplayer.authority },
    capabilities: { ...multiplayer.capabilities },
    compatibility: {
      ...multiplayer.compatibility,
      reasons: [...multiplayer.compatibility.reasons],
    },
    synchronization: { ...multiplayer.synchronization },
    conflict: {
      ...multiplayer.conflict,
      pendingConflictIds: [...multiplayer.conflict.pendingConflictIds],
    },
    battlefields: multiplayer.battlefields.map((battlefield) => ({
      ...battlefield,
    })),
  };
}

function createLocalMultiplayerParticipant(
  session: SharedSessionMetadata,
  objectIds: string[],
): SessionParticipant {
  const base =
    session.participants.find((participant) => participant.local) ??
    session.participants[0];
  return {
    id: base?.id ?? createParticipantId(),
    role: "lite-user",
    label: base?.label ?? "Local Lite Player",
    local: true,
    connected: true,
    applicationType: "boardstate-lite",
    capabilities: createDisabledSessionCapabilities(),
    authorityLevel: "local-lite",
    connectionState: "local",
    version: session.liteAppVersion,
    compatibilityStatus: "compatible",
    ownership: {
      ownsLocalBattlefield: true,
      objectIds,
    },
  };
}

function createCompatibility(timestamp: string): MultiplayerCompatibility {
  return {
    status: "compatible",
    checkedAt: timestamp,
    compatibilityVersion: MULTIPLAYER_COMPATIBILITY_VERSION,
    participantVersion: MULTIPLAYER_STATE_VERSION,
    synchronizationVersion: 1,
    reasons: [],
  };
}

function createSynchronizationModel(): SynchronizationModel {
  return {
    version: 1,
    state: "localOnly",
    lastPublishedAt: null,
    lastReceivedAt: null,
    lastHeartbeatAt: null,
    unavailableReason: MULTIPLAYER_UNAVAILABLE_REASON,
  };
}

function createConflictModel(): ConflictModel {
  return {
    status: "unused",
    strategy: "authorityWins",
    lastConflictAt: null,
    lastResolutionAt: null,
    pendingConflictIds: [],
  };
}

function createDiscoveryModel(): DiscoveryModel {
  return {
    available: false,
    methods: {
      hub: false,
      directAppLink: false,
      lan: false,
      cloud: false,
    },
    unavailableReason: MULTIPLAYER_UNAVAILABLE_REASON,
  };
}

function normalizeRegistry(
  value: unknown,
  session: SharedSessionMetadata,
  objectIds: string[],
): ParticipantRegistry {
  const participant = createLocalMultiplayerParticipant(session, objectIds);
  if (!value || typeof value !== "object") {
    return {
      localParticipantId: participant.id,
      participants: [participant],
    };
  }
  const candidate = value as Partial<ParticipantRegistry>;
  const localId =
    typeof candidate.localParticipantId === "string"
      ? candidate.localParticipantId
      : localParticipantId(session);
  return {
    localParticipantId: localId || participant.id,
    participants: [{ ...participant, id: localId || participant.id }],
  };
}

function normalizeCompatibility(
  value: unknown,
  timestamp: string,
): MultiplayerCompatibility {
  const defaults = createCompatibility(timestamp);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<MultiplayerCompatibility>;
  return {
    ...defaults,
    status:
      candidate.status === "incompatible" ||
      candidate.status === "unsupportedVersion" ||
      candidate.status === "unknown"
        ? candidate.status
        : "compatible",
    checkedAt: timestamp,
    reasons: Array.isArray(candidate.reasons)
      ? candidate.reasons.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };
}

function normalizeSynchronization(value: unknown): SynchronizationModel {
  const defaults = createSynchronizationModel();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<SynchronizationModel>;
  return {
    ...defaults,
    version:
      typeof candidate.version === "number"
        ? candidate.version
        : defaults.version,
    state: "localOnly",
    lastPublishedAt:
      typeof candidate.lastPublishedAt === "string"
        ? candidate.lastPublishedAt
        : null,
    lastReceivedAt:
      typeof candidate.lastReceivedAt === "string"
        ? candidate.lastReceivedAt
        : null,
    lastHeartbeatAt:
      typeof candidate.lastHeartbeatAt === "string"
        ? candidate.lastHeartbeatAt
        : null,
    unavailableReason: MULTIPLAYER_UNAVAILABLE_REASON,
  };
}

function normalizeConflict(value: unknown): ConflictModel {
  const defaults = createConflictModel();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<ConflictModel>;
  return {
    ...defaults,
    status:
      candidate.status === "pending" ||
      candidate.status === "resolved" ||
      candidate.status === "error"
        ? candidate.status
        : "unused",
    strategy:
      candidate.strategy === "newestWins" ||
      candidate.strategy === "manualResolution" ||
      candidate.strategy === "versionResolution"
        ? candidate.strategy
        : "authorityWins",
    pendingConflictIds: Array.isArray(candidate.pendingConflictIds)
      ? candidate.pendingConflictIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };
}

function normalizeBattlefields(
  value: unknown,
  localParticipantId: string,
): BattlefieldParticipation[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [
      {
        scope: "local",
        participantId: localParticipantId,
        authority: "local-lite",
        visibility: "localOnly",
        synchronizationState: "localOnly",
      },
    ];
  }
  return [
    {
      scope: "local",
      participantId: localParticipantId,
      authority: "local-lite",
      visibility: "localOnly",
      synchronizationState: "localOnly",
    },
  ];
}
