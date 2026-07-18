import {
  createStandaloneHubCapabilities,
  normalizeHubCapabilities,
} from "./capabilities";
import {
  HUB_APPLICATION_ID,
  HUB_APPLICATION_NAME,
  HUB_INTEGRATION_VERSION,
  HUB_LITE_APP_VERSION,
  type EcosystemApplicationRegistration,
  type EcosystemApplicationRegistry,
} from "./types";

export function createApplicationRegistry(
  timestamp = new Date().toISOString(),
): EcosystemApplicationRegistry {
  return {
    version: HUB_INTEGRATION_VERSION,
    applications: [createLiteApplicationRegistration()],
    localApplicationId: HUB_APPLICATION_ID,
    updatedAt: timestamp,
  };
}

export function createLiteApplicationRegistration(): EcosystemApplicationRegistration {
  return {
    applicationId: HUB_APPLICATION_ID,
    displayName: HUB_APPLICATION_NAME,
    version: HUB_LITE_APP_VERSION,
    status: "standalone",
    capabilities: createStandaloneHubCapabilities(),
    compatibilityStatus: "compatible",
    authorityLevel: "local-lite",
    connectionStatusLabel: "Standalone Mode",
    unavailableReason: null,
    lastSeenAt: null,
  };
}

export function normalizeApplicationRegistry(
  value: unknown,
  timestamp = new Date().toISOString(),
): EcosystemApplicationRegistry {
  const defaults = createApplicationRegistry(timestamp);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EcosystemApplicationRegistry>;
  return {
    ...defaults,
    ...candidate,
    version:
      typeof candidate.version === "number"
        ? candidate.version
        : HUB_INTEGRATION_VERSION,
    applications: [normalizeLiteApplication(candidate.applications)],
    localApplicationId: HUB_APPLICATION_ID,
    updatedAt: timestamp,
  };
}

function normalizeLiteApplication(
  value: EcosystemApplicationRegistration[] | undefined,
): EcosystemApplicationRegistration {
  const existing = Array.isArray(value)
    ? value.find((entry) => entry.applicationId === HUB_APPLICATION_ID)
    : undefined;
  const defaults = createLiteApplicationRegistration();
  if (!existing) return defaults;
  return {
    ...defaults,
    ...existing,
    applicationId: HUB_APPLICATION_ID,
    displayName: HUB_APPLICATION_NAME,
    version:
      typeof existing.version === "string"
        ? existing.version
        : HUB_LITE_APP_VERSION,
    status: "standalone",
    capabilities: normalizeHubCapabilities(existing.capabilities),
    compatibilityStatus:
      existing.compatibilityStatus === "incompatible" ||
      existing.compatibilityStatus === "unsupportedVersion" ||
      existing.compatibilityStatus === "unknown"
        ? existing.compatibilityStatus
        : "compatible",
    authorityLevel: "local-lite",
    connectionStatusLabel: "Standalone Mode",
    unavailableReason: null,
    lastSeenAt:
      typeof existing.lastSeenAt === "string" ? existing.lastSeenAt : null,
  };
}
