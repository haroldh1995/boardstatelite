import type { PermanentGroup } from "./types";
import { classifySupportedEffectOutcomes } from "./effectOutcomes";

export interface AvailablePermanentAction {
  id: string;
  kind: "tap-ability";
  cost: string;
  effect: string;
  label: string;
  manualResolution: boolean;
}
export function availablePermanentActions(
  group: PermanentGroup,
): AvailablePermanentAction[] {
  if (
    group.zone !== "battlefield" ||
    group.statuses.tapped ||
    group.statuses.faceDown ||
    group.trackingEnabled === false ||
    group.depowerMode === "all" ||
    (!group.abilitiesActive && group.depowerMode !== "triggered") ||
    !group.identity
  )
    return [];
  return group.identity.oracleText.split(/\r?\n/).flatMap((line, index) => {
    const colon = line.indexOf(":");
    if (colon < 0 || !/\{T\}/i.test(line.slice(0, colon))) return [];
    if (
      group.disabledAbilities.some(
        (disabled) =>
          disabled === line ||
          disabled === String(index) ||
          disabled === `ability:${index}`,
      )
    )
      return [];
    const cost = line.slice(0, colon).trim();
    const effect = line.slice(colon + 1).trim();
    const classification = classifySupportedEffectOutcomes(effect);
    return [
      {
        id: `tap:${index}:${line}`,
        kind: "tap-ability" as const,
        cost,
        effect,
        label: `${cost.replace(/\{T\}/gi, "Tap")}: ${effect}`,
        manualResolution:
          cost !== "{T}" || classification.status !== "supported",
      },
    ];
  });
}
