import type {
  AmbientFieldMutation,
  AmbientIntentInput,
} from "./ambientEventTypes";
import { requestVenture } from "../domain/dungeons";
import { withDungeonMemory } from "../domain/dungeonMemory";

// This mutation is invoked only after the existing Echo approval/confidence pipeline accepts the intent.
export function dungeonIntentMutation(
  intent: AmbientIntentInput,
): AmbientFieldMutation | undefined {
  if (intent.kind !== "custom") return undefined;
  const action = intent.payload?.action;
  if (
    !["take-initiative", "venture-dungeon", "venture-undercity"].includes(
      String(action),
    )
  )
    return undefined;
  return ({ field, intent: accepted }) => {
    const playerId = field.multiplayer.registry.localParticipantId;
    const dungeons = requestVenture(field.externalGameState.dungeons, {
      id: `echo:${accepted.id}`,
      playerId,
      kind: action === "venture-dungeon" ? "dungeon" : "undercity",
      reason: action === "take-initiative" ? "initiative" : "venture",
      at: accepted.createdAt,
    });
    if (dungeons === field.externalGameState.dungeons) return field;
    return withDungeonMemory({
      ...field,
      externalGameState: {
        ...field.externalGameState,
        dungeons,
        initiativeHolderId:
          action === "take-initiative"
            ? playerId
            : field.externalGameState.initiativeHolderId,
      },
    });
  };
}
