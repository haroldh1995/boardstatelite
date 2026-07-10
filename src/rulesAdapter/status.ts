import type { RulesAdapterStatus } from "./types";

export const RULES_ADAPTER_STATUSES = [
  "unavailable",
  "disconnected",
  "connecting",
  "connected",
  "error",
  "unsupportedVersion",
] as const satisfies readonly RulesAdapterStatus[];

export function isRulesAdapterStatus(
  value: unknown,
): value is RulesAdapterStatus {
  return (
    typeof value === "string" &&
    RULES_ADAPTER_STATUSES.includes(value as RulesAdapterStatus)
  );
}
