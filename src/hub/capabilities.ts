import type { EcosystemCapability, EcosystemCapabilityMap } from "./types";

export const HUB_CAPABILITIES = [
  "localProfile",
  "hubProfile",
  "friends",
  "localNotifications",
  "remoteNotifications",
  "localBackup",
  "manualBackup",
  "cloudBackup",
  "crossAppLaunching",
  "deepLinks",
  "sharedSessions",
  "replay",
  "rulesAuthority",
  "collectionAccess",
  "deckValidation",
  "tournamentInvites",
  "preferenceSync",
  "accessibilitySync",
] as const satisfies readonly EcosystemCapability[];

const LOCAL_CAPABILITIES = new Set<EcosystemCapability>([
  "localProfile",
  "localBackup",
  "manualBackup",
]);

export function createStandaloneHubCapabilities(): EcosystemCapabilityMap {
  return HUB_CAPABILITIES.reduce<EcosystemCapabilityMap>(
    (capabilities, capability) => ({
      ...capabilities,
      [capability]: LOCAL_CAPABILITIES.has(capability),
    }),
    {} as EcosystemCapabilityMap,
  );
}

export function normalizeHubCapabilities(
  value: Partial<EcosystemCapabilityMap> | null | undefined,
): EcosystemCapabilityMap {
  void value;
  const standalone = createStandaloneHubCapabilities();
  return HUB_CAPABILITIES.reduce<EcosystemCapabilityMap>(
    (capabilities, capability) => ({
      ...capabilities,
      [capability]: Boolean(standalone[capability]),
    }),
    {} as EcosystemCapabilityMap,
  );
}
