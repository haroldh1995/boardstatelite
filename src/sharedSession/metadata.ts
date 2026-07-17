import { RULES_ADAPTER_VERSION } from "../rulesAdapter/types";
import { createDisabledSessionCapabilities } from "./capabilities";
import { createParticipantId, createSessionId } from "./identity";
import type {
  ParticipantApplicationType,
  ParticipantAuthorityLevel,
  ParticipantCompatibilityStatus,
  ParticipantConnectionState,
  ParticipantRole,
  SessionParticipant,
  SharedSessionMetadata,
  SharedSessionSnapshot,
} from "./types";
import {
  SHARED_SESSION_COMPATIBILITY_VERSION,
  SHARED_SESSION_SERIALIZATION_VERSION,
  SHARED_SESSION_VERSION,
} from "./types";

const LITE_APP_VERSION = "0.0.0";

export function createLocalSessionMetadata(
  timestamp = new Date().toISOString(),
): SharedSessionMetadata {
  return {
    id: createSessionId(),
    version: SHARED_SESSION_VERSION,
    createdAt: timestamp,
    lastModifiedAt: timestamp,
    liteAppVersion: LITE_APP_VERSION,
    serializationVersion: SHARED_SESSION_SERIALIZATION_VERSION,
    rulesAdapterVersion: RULES_ADAPTER_VERSION,
    currentRulesAuthority: "local-lite",
    currentSessionAuthority: "local-lite",
    status: "localOnly",
    importExport: {
      imported: false,
      importedAt: null,
      exported: false,
      exportedAt: null,
      source: "local",
    },
    futureCompatibilityVersion: SHARED_SESSION_COMPATIBILITY_VERSION,
    synchronizationVersion: 1,
    participants: [createLocalParticipant()],
    capabilities: createDisabledSessionCapabilities(),
  };
}

export function normalizeSessionMetadata(
  value: unknown,
  options: {
    fallbackTimestamp: string;
    imported?: boolean;
  },
): SharedSessionMetadata {
  const defaults = createLocalSessionMetadata(options.fallbackTimestamp);
  if (!value || typeof value !== "object") {
    return markImported(defaults, options);
  }
  const candidate = value as Partial<SharedSessionMetadata>;
  const participants = normalizeParticipants(candidate.participants);
  const normalized: SharedSessionMetadata = {
    ...defaults,
    ...candidate,
    id: typeof candidate.id === "string" ? candidate.id : defaults.id,
    version:
      typeof candidate.version === "number"
        ? candidate.version
        : SHARED_SESSION_VERSION,
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : defaults.createdAt,
    lastModifiedAt: options.fallbackTimestamp,
    liteAppVersion:
      typeof candidate.liteAppVersion === "string"
        ? candidate.liteAppVersion
        : LITE_APP_VERSION,
    serializationVersion:
      typeof candidate.serializationVersion === "number"
        ? candidate.serializationVersion
        : SHARED_SESSION_SERIALIZATION_VERSION,
    rulesAdapterVersion:
      typeof candidate.rulesAdapterVersion === "string"
        ? candidate.rulesAdapterVersion
        : RULES_ADAPTER_VERSION,
    currentRulesAuthority: "local-lite",
    currentSessionAuthority: "local-lite",
    status: "localOnly",
    importExport: {
      ...defaults.importExport,
      ...candidate.importExport,
      source:
        candidate.importExport?.source === "future-ecosystem" ||
        candidate.importExport?.source === "json"
          ? candidate.importExport.source
          : "local",
    },
    futureCompatibilityVersion:
      typeof candidate.futureCompatibilityVersion === "string"
        ? candidate.futureCompatibilityVersion
        : SHARED_SESSION_COMPATIBILITY_VERSION,
    synchronizationVersion:
      typeof candidate.synchronizationVersion === "number"
        ? candidate.synchronizationVersion
        : 1,
    participants,
    capabilities: createDisabledSessionCapabilities(),
  };
  return markImported(normalized, options);
}

export function createSessionSnapshot(
  session: SharedSessionMetadata,
): SharedSessionSnapshot {
  return {
    metadata: session,
    participants: [...session.participants],
    authority: {
      rules: session.currentRulesAuthority,
      session: session.currentSessionAuthority,
      status: session.status,
    },
    capabilities: { ...session.capabilities },
  };
}

function createLocalParticipant(): SessionParticipant {
  return {
    id: createParticipantId(),
    role: "lite-user",
    label: "Local Lite Player",
    local: true,
    connected: true,
    applicationType: "boardstate-lite",
    capabilities: createDisabledSessionCapabilities(),
    authorityLevel: "local-lite",
    connectionState: "local",
    version: LITE_APP_VERSION,
    compatibilityStatus: "compatible",
    ownership: {
      ownsLocalBattlefield: true,
      objectIds: [],
    },
  };
}

function normalizeParticipants(value: unknown): SessionParticipant[] {
  if (!Array.isArray(value) || value.length === 0)
    return [createLocalParticipant()];
  const candidate = value.find((entry): entry is Partial<SessionParticipant> =>
    Boolean(entry && typeof entry === "object" && entry.local === true),
  ) as Partial<SessionParticipant> | undefined;
  const fallback = value.find((entry): entry is Partial<SessionParticipant> =>
    Boolean(entry && typeof entry === "object"),
  );
  const selected = candidate ?? fallback;
  if (!selected) return [createLocalParticipant()];
  return [normalizeLocalParticipant(selected)];
}

function normalizeLocalParticipant(
  entry: Partial<SessionParticipant>,
): SessionParticipant {
  const role = normalizeRole(entry.role);
  return {
    id: typeof entry.id === "string" ? entry.id : createParticipantId(),
    role,
    label:
      typeof entry.label === "string" && entry.label.trim()
        ? entry.label.trim().slice(0, 80)
        : "Local Lite Player",
    local: true,
    connected: true,
    applicationType: normalizeApplicationType(entry.applicationType),
    capabilities: createDisabledSessionCapabilities(),
    authorityLevel: normalizeAuthorityLevel(entry.authorityLevel),
    connectionState: normalizeConnectionState(entry.connectionState),
    version:
      typeof entry.version === "string" ? entry.version : LITE_APP_VERSION,
    compatibilityStatus: normalizeCompatibilityStatus(
      entry.compatibilityStatus,
    ),
    ownership: {
      ownsLocalBattlefield: true,
      objectIds: Array.isArray(entry.ownership?.objectIds)
        ? entry.ownership.objectIds.filter(
            (objectId): objectId is string => typeof objectId === "string",
          )
        : [],
    },
  };
}

function normalizeRole(value: unknown): ParticipantRole {
  void value;
  return "lite-user";
}

function normalizeApplicationType(value: unknown): ParticipantApplicationType {
  void value;
  return "boardstate-lite";
}

function normalizeAuthorityLevel(value: unknown): ParticipantAuthorityLevel {
  void value;
  return "local-lite";
}

function normalizeConnectionState(value: unknown): ParticipantConnectionState {
  void value;
  return "local";
}

function normalizeCompatibilityStatus(
  value: unknown,
): ParticipantCompatibilityStatus {
  void value;
  return "compatible";
}

function markImported(
  session: SharedSessionMetadata,
  options: { fallbackTimestamp: string; imported?: boolean },
): SharedSessionMetadata {
  if (!options.imported) return session;
  return {
    ...session,
    status: "localOnly",
    currentRulesAuthority: "local-lite",
    currentSessionAuthority: "local-lite",
    importExport: {
      ...session.importExport,
      imported: true,
      importedAt: options.fallbackTimestamp,
      source: "json",
    },
  };
}
