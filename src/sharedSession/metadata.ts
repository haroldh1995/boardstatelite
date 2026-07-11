import { RULES_ADAPTER_VERSION } from "../rulesAdapter/types";
import {
  createDisabledSessionCapabilities,
  normalizeSessionCapabilities,
} from "./capabilities";
import { createParticipantId, createSessionId } from "./identity";
import type {
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
    capabilities: normalizeSessionCapabilities(candidate.capabilities),
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
  };
}

function normalizeParticipants(value: unknown): SessionParticipant[] {
  if (!Array.isArray(value) || value.length === 0)
    return [createLocalParticipant()];
  const participants: SessionParticipant[] = value
    .filter((entry): entry is Partial<SessionParticipant> =>
      Boolean(entry && typeof entry === "object"),
    )
    .map((entry, index) => {
      const role: ParticipantRole =
        entry.role === "advanced-user" ||
        entry.role === "observer" ||
        entry.role === "judge" ||
        entry.role === "spectator"
          ? entry.role
          : "lite-user";
      return {
        id: typeof entry.id === "string" ? entry.id : createParticipantId(),
        role,
        label:
          typeof entry.label === "string" && entry.label.trim()
            ? entry.label.trim().slice(0, 80)
            : index === 0
              ? "Local Lite Player"
              : "Participant",
        local: index === 0 ? true : Boolean(entry.local),
        connected: index === 0 ? true : Boolean(entry.connected),
      };
    });
  if (participants.length === 0) return [createLocalParticipant()];
  return participants.some((participant) => participant.local)
    ? participants
    : [
        { ...participants[0], local: true, connected: true },
        ...participants.slice(1),
      ];
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
