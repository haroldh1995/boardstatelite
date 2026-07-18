import type { FieldState } from "../domain/types";
import { crossAppLaunchManager } from "./launch";
import {
  CLOUD_BACKUP_UNAVAILABLE_REASON,
  CROSS_APP_UNAVAILABLE_REASON,
  FRIENDS_UNAVAILABLE_REASON,
  HUB_UNAVAILABLE_REASON,
  NOTIFICATIONS_UNAVAILABLE_REASON,
  createHubSnapshot,
  normalizeHubState,
} from "./state";
import type {
  CrossAppLaunchResult,
  CrossAppLaunchTarget,
  DeepLinkAction,
  DeepLinkPreparationResult,
  HubDiagnostics,
  HubIntegrationState,
  HubSnapshot,
  HubUnavailableResult,
} from "./types";

export class HubIntegrationManager {
  private lastHub: HubIntegrationState | null = null;
  private lastError: string | null = null;
  private lastUnavailableReason: string | null = null;

  ensureHub(field: FieldState): HubIntegrationState {
    const hub = normalizeHubState(field.hub, {
      fallbackTimestamp: field.updatedAt,
      settings: field.settings,
    });
    this.lastHub = hub;
    return hub;
  }

  snapshot(field: FieldState): HubSnapshot {
    return createHubSnapshot(this.ensureHub(field));
  }

  negotiateCapabilities(field: FieldState): HubIntegrationState {
    return this.ensureHub(field);
  }

  connectHub(): HubUnavailableResult {
    return this.unavailable(HUB_UNAVAILABLE_REASON);
  }

  syncProfile(): HubUnavailableResult {
    return this.unavailable(HUB_UNAVAILABLE_REASON);
  }

  fetchFriends(): HubUnavailableResult {
    return this.unavailable(FRIENDS_UNAVAILABLE_REASON);
  }

  sendNotification(): HubUnavailableResult {
    return this.unavailable(NOTIFICATIONS_UNAVAILABLE_REASON);
  }

  backupToHub(): HubUnavailableResult {
    return this.unavailable(CLOUD_BACKUP_UNAVAILABLE_REASON);
  }

  launch(target: CrossAppLaunchTarget): CrossAppLaunchResult {
    this.lastUnavailableReason = CROSS_APP_UNAVAILABLE_REASON;
    return crossAppLaunchManager.launch(target);
  }

  prepareDeepLink(
    action: DeepLinkAction,
    target: CrossAppLaunchTarget | null = null,
  ): DeepLinkPreparationResult {
    this.lastUnavailableReason =
      "Deep links are unavailable until ecosystem routes are registered.";
    return crossAppLaunchManager.prepareDeepLink(action, target);
  }

  diagnostics(field?: FieldState): HubDiagnostics | null {
    const hub = field ? this.ensureHub(field) : this.lastHub;
    if (!hub) return null;
    return {
      status: hub.status,
      hubAvailable: false,
      profileStatus: hub.profile.status,
      profileId: hub.profile.id,
      applicationRegistry: hub.registry.applications.map((application) => ({
        ...application,
        capabilities: { ...application.capabilities },
      })),
      capabilities: { ...hub.capabilities },
      friendStatus: hub.friends.status,
      notificationStatus: hub.notifications.status,
      backupStatus: hub.backup.status,
      crossAppStatus: hub.crossApp.status,
      lastUnavailableReason: this.lastUnavailableReason,
      lastError: this.lastError,
    };
  }

  private unavailable(reason: string): HubUnavailableResult {
    this.lastUnavailableReason = reason;
    return {
      ok: false,
      status: "unavailable",
      reason,
    };
  }
}

export const hubIntegrationManager = new HubIntegrationManager();

installHubDiagnosticsGlobal();

function installHubDiagnosticsGlobal(): void {
  if (typeof globalThis === "undefined") return;
  const target = globalThis as typeof globalThis & {
    __BAORD_STATE_LITE_HUB__?: {
      getDiagnostics: (field?: FieldState) => HubDiagnostics | null;
    };
  };
  target.__BAORD_STATE_LITE_HUB__ = {
    getDiagnostics: (field?: FieldState) =>
      hubIntegrationManager.diagnostics(field),
  };
}
