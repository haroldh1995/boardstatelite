import type { FieldState, Owner } from "../domain/types";

export const SHARED_SESSION_VERSION = 1;
export const SHARED_SESSION_SERIALIZATION_VERSION = 1;
export const SHARED_SESSION_COMPATIBILITY_VERSION = "0.1.0";
export const SHARED_SESSION_EXPORT_KIND = "baord-state-lite-session";

export type SessionAuthority =
  | "local-lite"
  | "boardstate-authority"
  | "judge-authority"
  | "unknown";

export type SessionStatus =
  | "localOnly"
  | "readyForSharing"
  | "imported"
  | "exported"
  | "awaitingAuthority"
  | "connected"
  | "disconnected"
  | "error";

export type ParticipantRole =
  | "lite-user"
  | "advanced-user"
  | "observer"
  | "judge"
  | "spectator";

export type SessionCapability =
  | "sharedSnapshots"
  | "sharedBattlefield"
  | "rulesAuthority"
  | "multiplayer"
  | "spectator"
  | "replay"
  | "advancedMode"
  | "hubNotifications"
  | "judgeActions"
  | "notifications"
  | "sharedChat"
  | "dryRun"
  | "tutorial"
  | "deckValidation";

export type SessionCapabilityMap = Record<SessionCapability, boolean>;

export type ParticipantApplicationType =
  | "boardstate-lite"
  | "boardstate-advanced"
  | "unknown";

export type ParticipantAuthorityLevel = SessionAuthority;

export type ParticipantConnectionState =
  | "local"
  | "unavailable"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type ParticipantCompatibilityStatus =
  | "compatible"
  | "incompatible"
  | "unsupportedVersion"
  | "unknown";

export type ObjectVisibility =
  | "localOnly"
  | "private"
  | "shared"
  | "hidden"
  | "public";

export type ObjectSynchronizationState =
  | "localOnly"
  | "clean"
  | "dirty"
  | "pending"
  | "conflicted"
  | "unknown";

export type ObjectAuthoritySource = SessionAuthority;

export interface SessionParticipant {
  id: string;
  role: ParticipantRole;
  label: string;
  local: boolean;
  connected: boolean;
  applicationType: ParticipantApplicationType;
  capabilities: SessionCapabilityMap;
  authorityLevel: ParticipantAuthorityLevel;
  connectionState: ParticipantConnectionState;
  version: string;
  compatibilityStatus: ParticipantCompatibilityStatus;
  ownership: {
    ownsLocalBattlefield: boolean;
    objectIds: string[];
  };
}

export interface SessionImportExportState {
  imported: boolean;
  importedAt: string | null;
  exported: boolean;
  exportedAt: string | null;
  source: "local" | "json" | "future-ecosystem";
}

export interface SessionEcosystemMetadata {
  profileId: string | null;
  applicationOrigin: "boardstate-lite";
  applicationVersion: string;
  backupVersion: number;
  exportVersion: number;
  hubId: string | null;
  hubCompatibilityVersion: string;
}

export interface SharedSessionMetadata {
  id: string;
  version: number;
  createdAt: string;
  lastModifiedAt: string;
  liteAppVersion: string;
  serializationVersion: number;
  rulesAdapterVersion: string;
  currentRulesAuthority: SessionAuthority;
  currentSessionAuthority: SessionAuthority;
  status: SessionStatus;
  importExport: SessionImportExportState;
  ecosystem: SessionEcosystemMetadata;
  futureCompatibilityVersion: string;
  synchronizationVersion: number;
  participants: SessionParticipant[];
  capabilities: SessionCapabilityMap;
}

export interface ObjectSessionBinding {
  sessionId: string;
  objectId: string;
  objectIds: string[];
  ownerParticipantId: string;
  controllerParticipantId: string;
  visibility: ObjectVisibility;
  synchronizationState: ObjectSynchronizationState;
  authoritySource: ObjectAuthoritySource;
}

export interface SessionObjectSnapshot extends ObjectSessionBinding {
  groupId: string;
  owner: Owner;
  controller: Owner;
  quantity: number;
}

export interface SharedSessionSnapshot {
  metadata: SharedSessionMetadata;
  participants: SessionParticipant[];
  authority: {
    rules: SessionAuthority;
    session: SessionAuthority;
    status: SessionStatus;
  };
  capabilities: SessionCapabilityMap;
}

export interface SharedSessionExportEnvelope {
  kind: typeof SHARED_SESSION_EXPORT_KIND;
  exportVersion: number;
  exportedAt: string;
  session: SharedSessionMetadata;
  mode: FieldState["mode"];
  multiplayer: FieldState["multiplayer"];
  hub: FieldState["hub"];
  application: {
    id: "boardstate-lite";
    name: "Baord State Lite";
    version: string;
    mode: FieldState["mode"]["currentMode"];
    rulesAuthority: SharedSessionMetadata["currentRulesAuthority"];
    sessionAuthority: SharedSessionMetadata["currentSessionAuthority"];
    compatibilityVersion: string;
  };
  backup: {
    type: "local-json";
    status: "local-only";
    backupVersion: number;
    exportVersion: number;
    profileId: string | null;
    hubId: string | null;
  };
  authority: {
    rules: SharedSessionMetadata["currentRulesAuthority"];
    session: SharedSessionMetadata["currentSessionAuthority"];
    mode: "local-lite" | "boardstate-advanced" | "unknown";
    multiplayer:
      | "local-lite"
      | "boardstate-authority"
      | "judge-authority"
      | "unknown";
  };
  capabilities: {
    session: SharedSessionMetadata["capabilities"];
    simpleMode: FieldState["mode"]["simple"]["capabilities"];
    advancedMode: FieldState["mode"]["advanced"]["capabilities"];
    multiplayer: FieldState["multiplayer"]["capabilities"];
  };
  compatibility: FieldState["mode"]["compatibility"];
  field: FieldState;
  futureCompatibilityVersion: string;
  notes: string[];
}

export interface SessionDiagnostics {
  sessionId: string;
  status: SessionStatus;
  currentRulesAuthority: SessionAuthority;
  currentSessionAuthority: SessionAuthority;
  participantCount: number;
  capabilities: SessionCapabilityMap;
  synchronizationVersion: number;
  lastError: string | null;
  lastUnavailableReason: string | null;
}

export interface SessionHookResult {
  ok: false;
  reason: string;
  status: SessionStatus;
}
