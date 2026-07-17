import type {
  ObjectSynchronizationState,
  ObjectVisibility,
  ParticipantApplicationType,
  SessionAuthority,
  SessionCapabilityMap,
  SessionParticipant,
} from "../sharedSession/types";

export const MULTIPLAYER_STATE_VERSION = 1;
export const MULTIPLAYER_COMPATIBILITY_VERSION = "0.1.0";

export type MultiplayerStatus =
  | "localOnly"
  | "unavailable"
  | "joining"
  | "connected"
  | "disconnected"
  | "error";

export type BattlefieldScope = "local" | "remote" | "authoritative";

export type ConflictStrategy =
  | "authorityWins"
  | "newestWins"
  | "manualResolution"
  | "versionResolution";

export type ConflictStatus = "unused" | "pending" | "resolved" | "error";

export type DiscoveryMethod = "hub" | "directAppLink" | "lan" | "cloud";

export interface ParticipantRegistry {
  localParticipantId: string;
  participants: SessionParticipant[];
}

export interface AuthorityOwnership {
  current: SessionAuthority;
  rules: SessionAuthority;
  session: SessionAuthority;
  judge: SessionAuthority;
}

export interface MultiplayerCompatibility {
  status: "compatible" | "incompatible" | "unsupportedVersion" | "unknown";
  checkedAt: string;
  compatibilityVersion: string;
  participantVersion: number;
  synchronizationVersion: number;
  reasons: string[];
}

export interface SynchronizationModel {
  version: number;
  state: ObjectSynchronizationState;
  lastPublishedAt: string | null;
  lastReceivedAt: string | null;
  lastHeartbeatAt: string | null;
  unavailableReason: string;
}

export interface ConflictModel {
  status: ConflictStatus;
  strategy: ConflictStrategy;
  lastConflictAt: string | null;
  lastResolutionAt: string | null;
  pendingConflictIds: string[];
}

export interface DiscoveryModel {
  available: false;
  methods: Record<DiscoveryMethod, false>;
  unavailableReason: string;
}

export interface BattlefieldParticipation {
  scope: BattlefieldScope;
  participantId: string;
  authority: SessionAuthority;
  visibility: ObjectVisibility;
  synchronizationState: ObjectSynchronizationState;
}

export interface MultiplayerState {
  version: number;
  status: MultiplayerStatus;
  applicationType: ParticipantApplicationType;
  registry: ParticipantRegistry;
  authority: AuthorityOwnership;
  capabilities: SessionCapabilityMap;
  compatibility: MultiplayerCompatibility;
  synchronization: SynchronizationModel;
  conflict: ConflictModel;
  discovery: DiscoveryModel;
  battlefields: BattlefieldParticipation[];
  updatedAt: string;
}

export interface MultiplayerSnapshot {
  version: number;
  status: MultiplayerStatus;
  applicationType: ParticipantApplicationType;
  registry: ParticipantRegistry;
  authority: AuthorityOwnership;
  capabilities: SessionCapabilityMap;
  compatibility: MultiplayerCompatibility;
  synchronization: SynchronizationModel;
  conflict: ConflictModel;
  battlefields: BattlefieldParticipation[];
}

export interface MultiplayerDiagnostics {
  status: MultiplayerStatus;
  participantCount: number;
  localParticipantId: string;
  applicationType: ParticipantApplicationType;
  authority: AuthorityOwnership;
  multiplayerAvailable: boolean;
  synchronizationAvailable: boolean;
  conflictStrategy: ConflictStrategy;
  lastUnavailableReason: string | null;
  lastError: string | null;
}

export interface MultiplayerUnavailableResult {
  ok: false;
  status: "unavailable";
  reason: string;
}
