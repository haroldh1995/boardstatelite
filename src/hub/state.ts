import type { SettingsState } from "../domain/types";
import {
  createStandaloneHubCapabilities,
  normalizeHubCapabilities,
} from "./capabilities";
import { createLocalProfile, normalizeLocalProfile } from "./profile";
import {
  createApplicationRegistry,
  normalizeApplicationRegistry,
} from "./registry";
import {
  HUB_BACKUP_VERSION,
  HUB_COMPATIBILITY_VERSION,
  HUB_EXPORT_VERSION,
  HUB_INTEGRATION_VERSION,
  HUB_LITE_APP_VERSION,
  type BackupIntegrationState,
  type CrossAppLaunchState,
  type DeepLinkState,
  type FriendIntegrationState,
  type HubCompatibilityMetadata,
  type HubIntegrationState,
  type HubSnapshot,
  type NotificationIntegrationState,
} from "./types";

export const HUB_UNAVAILABLE_REASON =
  "BoardState Hub is unavailable until a real ecosystem service is configured.";
export const FRIENDS_UNAVAILABLE_REASON =
  "Friends require future BoardState Hub support.";
export const NOTIFICATIONS_UNAVAILABLE_REASON =
  "Remote notifications require future BoardState Hub support.";
export const CLOUD_BACKUP_UNAVAILABLE_REASON =
  "Cloud backup requires future BoardState Hub support.";
export const CROSS_APP_UNAVAILABLE_REASON =
  "Cross-app launching requires a configured BoardState ecosystem target.";
export const DEEP_LINK_UNAVAILABLE_REASON =
  "Deep links are unavailable until ecosystem routes are registered.";

export function createDefaultHubIntegrationState(
  options: {
    timestamp?: string;
    settings?: Partial<SettingsState>;
  } = {},
): HubIntegrationState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const capabilities = createStandaloneHubCapabilities();
  return {
    version: HUB_INTEGRATION_VERSION,
    status: "standalone",
    hubAvailability: "unavailable",
    profile: createLocalProfile(timestamp, options.settings),
    registry: createApplicationRegistry(timestamp),
    capabilities,
    friends: createFriendState(),
    notifications: createNotificationState(),
    backup: createBackupState(),
    crossApp: createCrossAppState(),
    deepLinks: createDeepLinkState(),
    compatibility: createHubCompatibility(timestamp),
    updatedAt: timestamp,
  };
}

export function normalizeHubState(
  value: unknown,
  options: {
    fallbackTimestamp: string;
    settings?: Partial<SettingsState>;
  },
): HubIntegrationState {
  const defaults = createDefaultHubIntegrationState({
    timestamp: options.fallbackTimestamp,
    settings: options.settings,
  });
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<HubIntegrationState>;
  return {
    ...defaults,
    ...candidate,
    version:
      typeof candidate.version === "number"
        ? candidate.version
        : HUB_INTEGRATION_VERSION,
    status: "standalone",
    hubAvailability: "unavailable",
    profile: normalizeLocalProfile(candidate.profile, {
      fallbackTimestamp: options.fallbackTimestamp,
      settings: options.settings,
    }),
    registry: normalizeApplicationRegistry(
      candidate.registry,
      options.fallbackTimestamp,
    ),
    capabilities: normalizeHubCapabilities(candidate.capabilities),
    friends: normalizeFriendState(candidate.friends),
    notifications: normalizeNotificationState(candidate.notifications),
    backup: normalizeBackupState(candidate.backup),
    crossApp: normalizeCrossAppState(candidate.crossApp),
    deepLinks: normalizeDeepLinkState(candidate.deepLinks),
    compatibility: normalizeHubCompatibility(
      candidate.compatibility,
      options.fallbackTimestamp,
    ),
    updatedAt: options.fallbackTimestamp,
  };
}

export function createHubSnapshot(hub: HubIntegrationState): HubSnapshot {
  const normalized = normalizeHubState(hub, {
    fallbackTimestamp: hub.updatedAt,
  });
  return {
    version: normalized.version,
    status: normalized.status,
    hubAvailability: normalized.hubAvailability,
    profile: {
      ...normalized.profile,
      connectedApplications: [...normalized.profile.connectedApplications],
      favoriteFormats: [...normalized.profile.favoriteFormats],
      favoriteDecks: [...normalized.profile.favoriteDecks],
    },
    registry: {
      ...normalized.registry,
      applications: normalized.registry.applications.map((application) => ({
        ...application,
        capabilities: { ...application.capabilities },
      })),
    },
    capabilities: { ...normalized.capabilities },
    backup: {
      ...normalized.backup,
      destinations: { ...normalized.backup.destinations },
    },
    crossApp: {
      ...normalized.crossApp,
      supportedTargets: { ...normalized.crossApp.supportedTargets },
    },
    deepLinks: {
      ...normalized.deepLinks,
      supportedActions: { ...normalized.deepLinks.supportedActions },
    },
    compatibility: {
      ...normalized.compatibility,
      reasons: [...normalized.compatibility.reasons],
    },
  };
}

export function createHubCompatibility(
  timestamp = new Date().toISOString(),
): HubCompatibilityMetadata {
  return {
    status: "compatible",
    checkedAt: timestamp,
    compatibilityVersion: HUB_COMPATIBILITY_VERSION,
    applicationVersion: HUB_LITE_APP_VERSION,
    profileVersion: 1,
    backupVersion: HUB_BACKUP_VERSION,
    reasons: [],
  };
}

function createFriendState(): FriendIntegrationState {
  return {
    status: "unavailable",
    friends: [],
    invitations: [],
    unavailableReason: FRIENDS_UNAVAILABLE_REASON,
  };
}

function createNotificationState(): NotificationIntegrationState {
  return {
    status: "unavailable",
    remoteStatus: "unavailable",
    localStatus: "unavailable",
    queuedNotifications: [],
    unavailableReason: NOTIFICATIONS_UNAVAILABLE_REASON,
  };
}

function createBackupState(): BackupIntegrationState {
  return {
    status: "local-only",
    destinations: {
      localExport: true,
      hubBackup: false,
      cloudBackup: false,
      manualBackup: true,
    },
    backupVersion: HUB_BACKUP_VERSION,
    exportVersion: HUB_EXPORT_VERSION,
    lastLocalExportAt: null,
    lastHubBackupAt: null,
    unavailableReason: CLOUD_BACKUP_UNAVAILABLE_REASON,
  };
}

function createCrossAppState(): CrossAppLaunchState {
  return {
    status: "unavailable",
    supportedTargets: {
      "boardstate-advanced": false,
      "deck-nexus": false,
      "boardstate-hub": false,
      "boardstate-lite": false,
    },
    lastAttemptAt: null,
    lastTarget: null,
    unavailableReason: CROSS_APP_UNAVAILABLE_REASON,
  };
}

function createDeepLinkState(): DeepLinkState {
  return {
    status: "unavailable",
    supportedActions: {
      "open-in-advanced": false,
      "open-in-deck-nexus": false,
      "continue-session": false,
      "resume-game": false,
      "open-profile": false,
      "open-collection": false,
      "return-to-lite": false,
    },
    lastPreparedAt: null,
    unavailableReason: DEEP_LINK_UNAVAILABLE_REASON,
  };
}

function normalizeFriendState(value: unknown): FriendIntegrationState {
  void value;
  return createFriendState();
}

function normalizeNotificationState(
  value: unknown,
): NotificationIntegrationState {
  void value;
  return createNotificationState();
}

function normalizeBackupState(value: unknown): BackupIntegrationState {
  const defaults = createBackupState();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<BackupIntegrationState>;
  return {
    ...defaults,
    ...candidate,
    status: "local-only",
    destinations: defaults.destinations,
    backupVersion:
      typeof candidate.backupVersion === "number"
        ? candidate.backupVersion
        : HUB_BACKUP_VERSION,
    exportVersion:
      typeof candidate.exportVersion === "number"
        ? candidate.exportVersion
        : HUB_EXPORT_VERSION,
    lastLocalExportAt:
      typeof candidate.lastLocalExportAt === "string"
        ? candidate.lastLocalExportAt
        : null,
    lastHubBackupAt:
      typeof candidate.lastHubBackupAt === "string"
        ? candidate.lastHubBackupAt
        : null,
    unavailableReason: CLOUD_BACKUP_UNAVAILABLE_REASON,
  };
}

function normalizeCrossAppState(value: unknown): CrossAppLaunchState {
  const defaults = createCrossAppState();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<CrossAppLaunchState>;
  return {
    ...defaults,
    status: "unavailable",
    supportedTargets: defaults.supportedTargets,
    lastAttemptAt:
      typeof candidate.lastAttemptAt === "string"
        ? candidate.lastAttemptAt
        : null,
    lastTarget:
      candidate.lastTarget === "boardstate-advanced" ||
      candidate.lastTarget === "deck-nexus" ||
      candidate.lastTarget === "boardstate-hub" ||
      candidate.lastTarget === "boardstate-lite"
        ? candidate.lastTarget
        : null,
    unavailableReason: CROSS_APP_UNAVAILABLE_REASON,
  };
}

function normalizeDeepLinkState(value: unknown): DeepLinkState {
  const defaults = createDeepLinkState();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<DeepLinkState>;
  return {
    ...defaults,
    status: "unavailable",
    supportedActions: defaults.supportedActions,
    lastPreparedAt:
      typeof candidate.lastPreparedAt === "string"
        ? candidate.lastPreparedAt
        : null,
    unavailableReason: DEEP_LINK_UNAVAILABLE_REASON,
  };
}

function normalizeHubCompatibility(
  value: unknown,
  timestamp: string,
): HubCompatibilityMetadata {
  const defaults = createHubCompatibility(timestamp);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<HubCompatibilityMetadata>;
  return {
    ...defaults,
    status:
      candidate.status === "incompatible" ||
      candidate.status === "unsupportedVersion" ||
      candidate.status === "unknown"
        ? candidate.status
        : "compatible",
    checkedAt: timestamp,
    compatibilityVersion:
      typeof candidate.compatibilityVersion === "string"
        ? candidate.compatibilityVersion
        : HUB_COMPATIBILITY_VERSION,
    applicationVersion:
      typeof candidate.applicationVersion === "string"
        ? candidate.applicationVersion
        : HUB_LITE_APP_VERSION,
    profileVersion:
      typeof candidate.profileVersion === "number"
        ? candidate.profileVersion
        : 1,
    backupVersion:
      typeof candidate.backupVersion === "number"
        ? candidate.backupVersion
        : HUB_BACKUP_VERSION,
    reasons: Array.isArray(candidate.reasons)
      ? candidate.reasons.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };
}
