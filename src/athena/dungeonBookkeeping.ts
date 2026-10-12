import type { FieldState } from "../domain/types";
import { dungeonRoom } from "../domain/dungeonCatalog";
import type { DungeonRoomResolution } from "../domain/dungeons";
import { splitGroupForQuantity } from "../domain/cards";
import {
  createAthenaForecastInput,
  createForecastEnvironment,
} from "./eventForecast";
import type { AthenaForecastInputDraft } from "./eventForecastTypes";
import type { AthenaPendingTriggerQueue } from "./triggerQueue";
import { processAthenaConfirmedEventWithBookkeeping } from "./triggerResolution";

/** Room metadata selects existing event primitives; the normal Athena pipeline resolves them. */
export function applyDungeonBookkeeping(
  field: FieldState,
  playerId: string,
  resolution: DungeonRoomResolution,
  targetId: string | undefined,
  queue: AthenaPendingTriggerQueue,
) {
  const effect = dungeonRoom(resolution.dungeonId, resolution.roomId)?.effect;
  const local = field.multiplayer.registry.localParticipantId;
  let working = field;
  let draft: Omit<AthenaForecastInputDraft, "eventId"> | null = null;
  if (effect?.kind === "life") {
    const affectsLocal =
      effect.audience === "each-player" ||
      (effect.audience === "target-player"
        ? targetId === local
        : playerId === local);
    if (effect.audience === "target-player" && !targetId)
      return { error: "Choose the player losing life.", result: null };
    if (!affectsLocal)
      return {
        error:
          "Resolve the other player's life change at the table, then mark it resolved.",
        result: null,
      };
    draft = {
      eventCategory: effect.amount >= 0 ? "life-gained" : "life-lost",
      quantity: Math.abs(effect.amount),
    };
  } else if (effect?.kind === "counters") {
    const target = field.groups.find(
      (group) =>
        group.id === targetId &&
        group.zone === "battlefield" &&
        group.characteristics.isCreature,
    );
    if (!target)
      return {
        error: "Choose a tracked creature, or resolve at the table.",
        result: null,
      };
    const split = splitGroupForQuantity(field.groups, target.id, 1);
    if (!split.targetId)
      return { error: "Choose a tracked creature.", result: null };
    working = { ...field, groups: split.groups };
    draft = {
      eventCategory: "counter-placed",
      quantity: effect.amount,
      counterType: "+1/+1",
      subjectGroupIds: [split.targetId],
    };
  } else if (effect?.kind === "token" && playerId === local) {
    draft = {
      eventCategory: "token-created",
      quantity: effect.quantity,
      tokenDefinition: {
        id: `dungeon-token:${resolution.dungeonId}:${resolution.roomId}`,
        name: effect.name,
        power: effect.power,
        toughness: effect.toughness,
        characteristics: {
          cardTypes: effect.types,
          subtypes: effect.subtypes,
          supertypes: effect.legendary ? ["Legendary"] : [],
          colors: effect.colors,
          manaValue: 0,
          isToken: true,
          isCreature: effect.types.includes("Creature"),
          isLegendary: effect.legendary === true,
          knownFields: [
            "cardTypes",
            "subtypes",
            "supertypes",
            "colors",
            "isToken",
            "isCreature",
            "isLegendary",
          ],
        },
      },
      metadata: {
        oracleText:
          effect.keywords.join(". ") ||
          (effect.name === "Treasure"
            ? "{T}, Sacrifice this artifact: Add one mana of any color."
            : ""),
      },
    };
  }
  if (!draft)
    return {
      error: "Resolve this effect at the table, then mark it resolved.",
      result: null,
    };
  const timestamp = new Date().toISOString();
  const event = createAthenaForecastInput(
    {
      ...draft,
      eventId: `dungeon-effect:${resolution.id}`,
      eventSource: "manual-report",
      authoritySource: "confirmed-user-report",
      timestamp,
      confidence: { level: "high", score: 1, speakerVerified: null },
      metadata: {
        ...draft.metadata,
        confirmed: true,
        canonicalEvent: true,
        hypothetical: false,
        dungeonId: resolution.dungeonId,
        roomId: resolution.roomId,
        roomEntryId: resolution.id,
      },
    },
    createForecastEnvironment(working),
  );
  const result = processAthenaConfirmedEventWithBookkeeping({
    field: working,
    event,
    queue,
    timestamp,
  });
  return result.validity === "committed"
    ? { error: null, result }
    : {
        error: "This effect needs manual resolution at the table.",
        result: null,
      };
}
