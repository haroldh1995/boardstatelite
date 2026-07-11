import type { SessionCapability, SessionCapabilityMap } from "./types";

export const SESSION_CAPABILITIES = [
  "sharedSnapshots",
  "sharedBattlefield",
  "rulesAuthority",
  "multiplayer",
  "spectator",
  "replay",
  "advancedMode",
  "hubNotifications",
] as const satisfies readonly SessionCapability[];

export function createDisabledSessionCapabilities(): SessionCapabilityMap {
  return SESSION_CAPABILITIES.reduce<SessionCapabilityMap>(
    (capabilities, capability) => ({
      ...capabilities,
      [capability]: false,
    }),
    {} as SessionCapabilityMap,
  );
}

export function normalizeSessionCapabilities(
  value: Partial<SessionCapabilityMap> | null | undefined,
): SessionCapabilityMap {
  return SESSION_CAPABILITIES.reduce<SessionCapabilityMap>(
    (capabilities, capability) => ({
      ...capabilities,
      [capability]: Boolean(value?.[capability]),
    }),
    {} as SessionCapabilityMap,
  );
}
