import { APP_ID, APP_NAME, APP_VERSION } from "../appMetadata";

export const HUB_INTEGRATION_VERSION = 1;
export const HUB_COMPATIBILITY_VERSION = "0.1.0";
export const HUB_BACKUP_VERSION = 1;
export const HUB_EXPORT_VERSION = 1;
export const HUB_APPLICATION_ID = APP_ID;
export const HUB_APPLICATION_NAME = APP_NAME;
export const HUB_LITE_APP_VERSION = APP_VERSION;

export type EcosystemApplicationId =
  | "boardstate-lite"
  | "boardstate-advanced"
  | "deck-nexus"
  | "boardstate-hub"
  | (string & {});

export type HubConnectionStatus =
  | "standalone"
  | "unavailable"
  | "connecting"
  | "connected"
  | "error";

export type HubAvailability = "unavailable" | "available" | "unknown";

export type EcosystemProfileStatus =
  | "local-anonymous"
  | "hub-linked"
  | "unavailable";

export type FriendIntegrationStatus = "unavailable" | "available" | "error";

export type NotificationIntegrationStatus =
  | "unavailable"
  | "local-only"
  | "connected"
  | "error";

export type BackupIntegrationStatus =
  | "local-only"
  | "unavailable"
  | "connected"
  | "error";

export type CrossAppLaunchStatus =
  | "unavailable"
  | "available"
  | "launching"
  | "error";

export type DeepLinkStatus = "unavailable" | "available" | "error";

export type ApplicationConnectionStatus =
  | "standalone"
  | "unavailable"
  | "connected"
  | "error";

export type ApplicationCompatibilityStatus =
  | "compatible"
  | "incompatible"
  | "unsupportedVersion"
  | "unknown";

export type EcosystemAuthorityLevel =
  | "local-lite"
  | "boardstate-authority"
  | "hub-authority"
  | "none"
  | "unknown";

export type EcosystemCapability =
  | "localProfile"
  | "hubProfile"
  | "friends"
  | "localNotifications"
  | "remoteNotifications"
  | "localBackup"
  | "manualBackup"
  | "cloudBackup"
  | "crossAppLaunching"
  | "deepLinks"
  | "sharedSessions"
  | "replay"
  | "rulesAuthority"
  | "collectionAccess"
  | "deckValidation"
  | "tournamentInvites"
  | "preferenceSync"
  | "accessibilitySync";

export type EcosystemCapabilityMap = Record<EcosystemCapability, boolean>;

export type CrossAppLaunchTarget =
  | "boardstate-advanced"
  | "deck-nexus"
  | "boardstate-hub"
  | "boardstate-lite";

export type DeepLinkAction =
  | "open-in-advanced"
  | "open-in-deck-nexus"
  | "continue-session"
  | "resume-game"
  | "open-profile"
  | "open-collection"
  | "return-to-lite";

export interface EcosystemProfile {
  id: string;
  status: EcosystemProfileStatus;
  displayName: string;
  avatarUrl: string | null;
  source: "local" | "hub";
  createdAt: string;
  updatedAt: string;
  themePreferences: {
    accent: "verdant" | "sapphire" | "violet";
  };
  accessibilityPreferences: {
    reducedMotion: boolean;
  };
  connectedApplications: EcosystemApplicationId[];
  favoriteFormats: string[];
  favoriteDecks: string[];
  preferencesSyncEnabled: boolean;
}

export interface EcosystemApplicationRegistration {
  applicationId: EcosystemApplicationId;
  displayName: string;
  version: string;
  status: ApplicationConnectionStatus;
  capabilities: EcosystemCapabilityMap;
  compatibilityStatus: ApplicationCompatibilityStatus;
  authorityLevel: EcosystemAuthorityLevel;
  connectionStatusLabel: string;
  unavailableReason: string | null;
  lastSeenAt: string | null;
}

export interface EcosystemApplicationRegistry {
  version: number;
  applications: EcosystemApplicationRegistration[];
  localApplicationId: typeof HUB_APPLICATION_ID;
  updatedAt: string;
}

export interface FriendIntegrationState {
  status: FriendIntegrationStatus;
  friends: [];
  invitations: [];
  unavailableReason: string;
}

export interface NotificationIntegrationState {
  status: NotificationIntegrationStatus;
  remoteStatus: "unavailable";
  localStatus: "unavailable";
  queuedNotifications: [];
  unavailableReason: string;
}

export interface BackupIntegrationState {
  status: BackupIntegrationStatus;
  destinations: {
    localExport: true;
    hubBackup: false;
    cloudBackup: false;
    manualBackup: true;
  };
  backupVersion: number;
  exportVersion: number;
  lastLocalExportAt: string | null;
  lastHubBackupAt: string | null;
  unavailableReason: string | null;
}

export interface CrossAppLaunchState {
  status: CrossAppLaunchStatus;
  supportedTargets: Record<CrossAppLaunchTarget, false>;
  lastAttemptAt: string | null;
  lastTarget: CrossAppLaunchTarget | null;
  unavailableReason: string;
}

export interface DeepLinkState {
  status: DeepLinkStatus;
  supportedActions: Record<DeepLinkAction, false>;
  lastPreparedAt: string | null;
  unavailableReason: string;
}

export interface HubCompatibilityMetadata {
  status: ApplicationCompatibilityStatus;
  checkedAt: string;
  compatibilityVersion: string;
  applicationVersion: string;
  profileVersion: number;
  backupVersion: number;
  reasons: string[];
}

export interface HubIntegrationState {
  version: number;
  status: HubConnectionStatus;
  hubAvailability: HubAvailability;
  profile: EcosystemProfile;
  registry: EcosystemApplicationRegistry;
  capabilities: EcosystemCapabilityMap;
  friends: FriendIntegrationState;
  notifications: NotificationIntegrationState;
  backup: BackupIntegrationState;
  crossApp: CrossAppLaunchState;
  deepLinks: DeepLinkState;
  compatibility: HubCompatibilityMetadata;
  updatedAt: string;
}

export interface HubSnapshot {
  version: number;
  status: HubConnectionStatus;
  hubAvailability: HubAvailability;
  profile: EcosystemProfile;
  registry: EcosystemApplicationRegistry;
  capabilities: EcosystemCapabilityMap;
  backup: BackupIntegrationState;
  crossApp: CrossAppLaunchState;
  deepLinks: DeepLinkState;
  compatibility: HubCompatibilityMetadata;
}

export interface HubDiagnostics {
  status: HubConnectionStatus;
  hubAvailable: boolean;
  profileStatus: EcosystemProfileStatus;
  profileId: string;
  applicationRegistry: EcosystemApplicationRegistration[];
  capabilities: EcosystemCapabilityMap;
  friendStatus: FriendIntegrationStatus;
  notificationStatus: NotificationIntegrationStatus;
  backupStatus: BackupIntegrationStatus;
  crossAppStatus: CrossAppLaunchStatus;
  lastUnavailableReason: string | null;
  lastError: string | null;
}

export interface HubUnavailableResult {
  ok: false;
  status: "unavailable";
  reason: string;
}

export interface CrossAppLaunchResult extends HubUnavailableResult {
  target: CrossAppLaunchTarget;
}

export interface DeepLinkPreparationResult extends HubUnavailableResult {
  action: DeepLinkAction;
  target: CrossAppLaunchTarget | null;
  url: null;
}
