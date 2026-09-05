import { getLandPlayTurnStatus } from "../echo/preTurnPlanner";
import type { FieldState } from "./types";

export type GameplayReminderKind = "land-play";

export interface GameplayReminder {
  id: string;
  kind: GameplayReminderKind;
  message: string;
  actionLabel: string;
  action: "open-land-play";
}

export function deriveGameplayReminders(field: FieldState): GameplayReminder[] {
  if (!field.settings.gameplayReminders) return [];
  const activeTurn = ["activeTurn", "combat"].includes(
    field.ambient.currentMode,
  );
  const landStatus = getLandPlayTurnStatus(field.preTurnPlanner);
  if (activeTurn && !landStatus.complete) {
    return [
      {
        id: `gameplay-reminder:land-play:${field.preTurnPlanner.turnId}`,
        kind: "land-play",
        message:
          landStatus.expected > 1
            ? `${landStatus.remaining} planned land play${landStatus.remaining === 1 ? "" : "s"} not marked yet.`
            : "Land play not marked yet.",
        actionLabel: "Update",
        action: "open-land-play",
      },
    ];
  }
  return [];
}
