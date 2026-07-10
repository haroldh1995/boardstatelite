import type {
  RulesAdapterCapability,
  RulesAdapterCapabilityMap,
} from "./types";

export const RULES_ADAPTER_CAPABILITIES = [
  "evaluateSnapshot",
  "sharedSession",
  "advancedMode",
  "multiplayerAuthority",
  "dryRun",
  "tutorialAuthority",
  "rulesReplay",
  "deckValidation",
] as const satisfies readonly RulesAdapterCapability[];

export function createUnavailableCapabilities(): RulesAdapterCapabilityMap {
  return RULES_ADAPTER_CAPABILITIES.reduce<RulesAdapterCapabilityMap>(
    (capabilities, capability) => ({
      ...capabilities,
      [capability]: false,
    }),
    {} as RulesAdapterCapabilityMap,
  );
}

export function normalizeCapabilities(
  value: Partial<RulesAdapterCapabilityMap> | null | undefined,
): RulesAdapterCapabilityMap {
  return RULES_ADAPTER_CAPABILITIES.reduce<RulesAdapterCapabilityMap>(
    (capabilities, capability) => ({
      ...capabilities,
      [capability]: Boolean(value?.[capability]),
    }),
    {} as RulesAdapterCapabilityMap,
  );
}
