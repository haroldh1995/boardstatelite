import {
  LITE_APP_VERSION,
  LITE_SNAPSHOT_VERSION,
  MINIMUM_BOARDSTATE_VERSION,
  RULES_ADAPTER_SERIALIZATION_VERSION,
  RULES_ADAPTER_VERSION,
} from "../rulesAdapter/types";
import { SHARED_SESSION_VERSION } from "../sharedSession/types";
import {
  createSimpleModeCapabilities,
  createUnavailableAdvancedCapabilities,
  normalizeModeCapabilities,
} from "./capabilities";
import type {
  GameplayMode,
  ModeCompatibilityMetadata,
  ModeDescriptor,
  ModeHandoffState,
  ModeReturnState,
  ModeSnapshot,
  ModeState,
} from "./types";
import { GAME_MODE_VERSION, MODE_COMPATIBILITY_VERSION } from "./types";

export const ADVANCED_UNAVAILABLE_REASON =
  "BoardState Advanced is not connected or installed.";

export function createDefaultModeState(
  timestamp = new Date().toISOString(),
): ModeState {
  return {
    version: GAME_MODE_VERSION,
    currentMode: "simple",
    simple: createSimpleModeDescriptor(),
    advanced: createAdvancedModeDescriptor(),
    compatibility: createModeCompatibility(timestamp),
    handoff: createDefaultHandoffState(),
    return: createDefaultReturnState(),
    updatedAt: timestamp,
  };
}

export function normalizeModeState(
  value: unknown,
  options: { fallbackTimestamp: string },
): ModeState {
  const defaults = createDefaultModeState(options.fallbackTimestamp);
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const candidate = value as Partial<ModeState>;
  return {
    ...defaults,
    ...candidate,
    version:
      typeof candidate.version === "number"
        ? candidate.version
        : GAME_MODE_VERSION,
    currentMode: normalizeCurrentMode(candidate.currentMode),
    simple: normalizeModeDescriptor(
      candidate.simple,
      createSimpleModeDescriptor(),
    ),
    advanced: {
      ...normalizeModeDescriptor(
        candidate.advanced,
        createAdvancedModeDescriptor(),
      ),
      mode: "advanced",
      label: "Advanced Mode",
      availability: "unavailable",
      unavailableReason: ADVANCED_UNAVAILABLE_REASON,
      capabilities: createUnavailableAdvancedCapabilities(),
    },
    compatibility: normalizeCompatibility(
      candidate.compatibility,
      options.fallbackTimestamp,
    ),
    handoff: normalizeHandoff(candidate.handoff),
    return: normalizeReturn(candidate.return),
    updatedAt: options.fallbackTimestamp,
  };
}

export function createModeSnapshot(mode: ModeState): ModeSnapshot {
  return {
    currentMode: mode.currentMode,
    availableModes: {
      simple: mode.simple.availability,
      advanced: mode.advanced.availability,
    },
    simple: {
      ...mode.simple,
      capabilities: { ...mode.simple.capabilities },
    },
    advanced: {
      ...mode.advanced,
      capabilities: { ...mode.advanced.capabilities },
    },
    compatibility: {
      ...mode.compatibility,
      reasons: [...mode.compatibility.reasons],
    },
    handoff: { ...mode.handoff },
  };
}

export function createModeCompatibility(
  timestamp = new Date().toISOString(),
): ModeCompatibilityMetadata {
  return {
    status: "compatible",
    checkedAt: timestamp,
    sessionVersion: SHARED_SESSION_VERSION,
    rulesAdapterVersion: RULES_ADAPTER_VERSION,
    serializationVersion: RULES_ADAPTER_SERIALIZATION_VERSION,
    snapshotVersion: LITE_SNAPSHOT_VERSION,
    authorityVersion: MINIMUM_BOARDSTATE_VERSION,
    liteAppVersion: LITE_APP_VERSION,
    compatibilityVersion: MODE_COMPATIBILITY_VERSION,
    reasons: [],
  };
}

function createSimpleModeDescriptor(): ModeDescriptor {
  return {
    mode: "simple",
    label: "Simple Mode",
    availability: "available",
    unavailableReason: null,
    capabilities: createSimpleModeCapabilities(),
  };
}

function createAdvancedModeDescriptor(): ModeDescriptor {
  return {
    mode: "advanced",
    label: "Advanced Mode",
    availability: "unavailable",
    unavailableReason: ADVANCED_UNAVAILABLE_REASON,
    capabilities: createUnavailableAdvancedCapabilities(),
  };
}

function createDefaultHandoffState(): ModeHandoffState {
  return {
    lockState: "unlocked",
    preparedAt: null,
    transferredAt: null,
    returnedAt: null,
    lastTarget: null,
    lastError: null,
    readyForFutureHandoff: true,
  };
}

function createDefaultReturnState(): ModeReturnState {
  return {
    lastReturnAt: null,
    lastSource: null,
    lastError: null,
  };
}

function normalizeCurrentMode(value: unknown): GameplayMode {
  return value === "advanced" ? "simple" : "simple";
}

function normalizeModeDescriptor(
  value: unknown,
  fallback: ModeDescriptor,
): ModeDescriptor {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<ModeDescriptor>;
  return {
    ...fallback,
    ...candidate,
    mode: fallback.mode,
    label:
      typeof candidate.label === "string" && candidate.label.trim()
        ? candidate.label.trim().slice(0, 80)
        : fallback.label,
    availability:
      candidate.availability === "unavailable"
        ? "unavailable"
        : fallback.availability,
    unavailableReason:
      typeof candidate.unavailableReason === "string"
        ? candidate.unavailableReason
        : fallback.unavailableReason,
    capabilities: normalizeModeCapabilities(
      candidate.capabilities,
      fallback.capabilities,
    ),
  };
}

function normalizeCompatibility(
  value: unknown,
  timestamp: string,
): ModeCompatibilityMetadata {
  const defaults = createModeCompatibility(timestamp);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<ModeCompatibilityMetadata>;
  return {
    ...defaults,
    ...candidate,
    status:
      candidate.status === "incompatible" ||
      candidate.status === "unsupportedVersion" ||
      candidate.status === "notReady"
        ? candidate.status
        : "compatible",
    checkedAt: timestamp,
    sessionVersion:
      typeof candidate.sessionVersion === "number"
        ? candidate.sessionVersion
        : defaults.sessionVersion,
    rulesAdapterVersion:
      typeof candidate.rulesAdapterVersion === "string"
        ? candidate.rulesAdapterVersion
        : defaults.rulesAdapterVersion,
    serializationVersion:
      typeof candidate.serializationVersion === "number"
        ? candidate.serializationVersion
        : defaults.serializationVersion,
    snapshotVersion:
      typeof candidate.snapshotVersion === "number"
        ? candidate.snapshotVersion
        : defaults.snapshotVersion,
    authorityVersion:
      typeof candidate.authorityVersion === "string"
        ? candidate.authorityVersion
        : defaults.authorityVersion,
    liteAppVersion:
      typeof candidate.liteAppVersion === "string"
        ? candidate.liteAppVersion
        : defaults.liteAppVersion,
    compatibilityVersion:
      typeof candidate.compatibilityVersion === "string"
        ? candidate.compatibilityVersion
        : defaults.compatibilityVersion,
    reasons: Array.isArray(candidate.reasons)
      ? candidate.reasons.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };
}

function normalizeHandoff(value: unknown): ModeHandoffState {
  const defaults = createDefaultHandoffState();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<ModeHandoffState>;
  return {
    ...defaults,
    ...candidate,
    lockState: "unlocked",
    preparedAt:
      typeof candidate.preparedAt === "string" ? candidate.preparedAt : null,
    transferredAt:
      typeof candidate.transferredAt === "string"
        ? candidate.transferredAt
        : null,
    returnedAt:
      typeof candidate.returnedAt === "string" ? candidate.returnedAt : null,
    lastTarget:
      candidate.lastTarget === "boardstate-advanced" ||
      candidate.lastTarget === "hub" ||
      candidate.lastTarget === "local-lite"
        ? candidate.lastTarget
        : null,
    lastError:
      typeof candidate.lastError === "string" ? candidate.lastError : null,
    readyForFutureHandoff: true,
  };
}

function normalizeReturn(value: unknown): ModeReturnState {
  const defaults = createDefaultReturnState();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<ModeReturnState>;
  return {
    ...defaults,
    ...candidate,
    lastReturnAt:
      typeof candidate.lastReturnAt === "string"
        ? candidate.lastReturnAt
        : null,
    lastSource:
      candidate.lastSource === "boardstate-advanced"
        ? "boardstate-advanced"
        : null,
    lastError:
      typeof candidate.lastError === "string" ? candidate.lastError : null,
  };
}
