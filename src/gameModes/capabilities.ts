import type { ModeCapability, ModeCapabilityMap } from "./types";

export const MODE_CAPABILITIES = [
  "lifeTracker",
  "battlefield",
  "counters",
  "tokens",
  "helperEngine",
  "localPersistence",
  "fullRulesAuthority",
  "multiplayerAuthority",
  "replay",
  "judgeTools",
  "dryRun",
  "simulations",
] as const satisfies readonly ModeCapability[];

const SIMPLE_MODE_CAPABILITIES = new Set<ModeCapability>([
  "lifeTracker",
  "battlefield",
  "counters",
  "tokens",
  "helperEngine",
  "localPersistence",
]);

export function createSimpleModeCapabilities(): ModeCapabilityMap {
  return MODE_CAPABILITIES.reduce<ModeCapabilityMap>(
    (capabilities, capability) => ({
      ...capabilities,
      [capability]: SIMPLE_MODE_CAPABILITIES.has(capability),
    }),
    {} as ModeCapabilityMap,
  );
}

export function createUnavailableAdvancedCapabilities(): ModeCapabilityMap {
  return MODE_CAPABILITIES.reduce<ModeCapabilityMap>(
    (capabilities, capability) => ({
      ...capabilities,
      [capability]: false,
    }),
    {} as ModeCapabilityMap,
  );
}

export function normalizeModeCapabilities(
  value: Partial<ModeCapabilityMap> | null | undefined,
  fallback: ModeCapabilityMap,
): ModeCapabilityMap {
  return MODE_CAPABILITIES.reduce<ModeCapabilityMap>(
    (capabilities, capability) => ({
      ...capabilities,
      [capability]: Boolean(value?.[capability] ?? fallback[capability]),
    }),
    {} as ModeCapabilityMap,
  );
}
