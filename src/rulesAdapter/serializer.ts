import { calculateTotals } from "../domain/field";
import type { CardIdentity, FieldState, PermanentGroup } from "../domain/types";
import { createModeSnapshot, normalizeModeState } from "../gameModes/state";
import { createHubSnapshot, normalizeHubState } from "../hub";
import {
  createMultiplayerSnapshot,
  normalizeMultiplayerState,
} from "../multiplayer/state";
import { createSessionSnapshot } from "../sharedSession";
import {
  LITE_APP_VERSION,
  LITE_SNAPSHOT_VERSION,
  RULES_ADAPTER_SERIALIZATION_VERSION,
  RULES_ADAPTER_VERSION,
  type CardIdentityLike,
  type LiteCardIdentitySnapshot,
  type LiteFieldSnapshot,
  type LitePermanentSnapshot,
} from "./types";

export function createLiteFieldSnapshot(field: FieldState): LiteFieldSnapshot {
  const mode = normalizeModeState(field.mode, {
    fallbackTimestamp: field.updatedAt,
  });
  const objectIds = field.groups.flatMap(
    (group) => group.session?.objectIds ?? [group.id],
  );
  const multiplayer = normalizeMultiplayerState(field.multiplayer, {
    session: field.session,
    fallbackTimestamp: field.updatedAt,
    objectIds,
  });
  const hub = normalizeHubState(field.hub, {
    fallbackTimestamp: field.updatedAt,
    settings: field.settings,
  });
  const sortedGroups = [...field.groups].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );

  return {
    metadata: {
      appName: "Baord State Lite",
      appVersion: LITE_APP_VERSION,
      fieldId: field.id,
      fieldName: field.name,
      fieldSchemaVersion: field.schemaVersion,
      snapshotVersion: LITE_SNAPSHOT_VERSION,
      serializationVersion: RULES_ADAPTER_SERIALIZATION_VERSION,
      rulesAdapterVersion: RULES_ADAPTER_VERSION,
      timestamp: field.updatedAt,
    },
    session: createSessionSnapshot(field.session),
    mode: createModeSnapshot(mode),
    multiplayer: createMultiplayerSnapshot(multiplayer),
    hub: createHubSnapshot(hub),
    player: {
      life: field.player.life,
      startingLife: field.player.startingLife,
      counters: {
        ...field.player.counters,
        custom: sortNumberRecord(field.player.counters.custom),
      },
      statuses: { ...field.player.statuses },
    },
    relevantTotals: calculateTotals(field.groups),
    opponentValues: {
      ...field.opponentValues,
      custom: sortNumberRecord(field.opponentValues.custom),
    },
    battlefield: sortedGroups.map((group) =>
      snapshotPermanent(group, field.session.id),
    ),
    customEffects: [...field.customEffects].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    preferences: {
      watcherPreferences: { ...field.watcherPreferences },
      orderingPreferences: sortStringArrayRecord(field.orderingPreferences),
      optionalPreferences: sortBooleanRecord(field.optionalPreferences),
    },
  };
}

export function serializeLiteFieldSnapshot(
  snapshot: LiteFieldSnapshot,
): string {
  return JSON.stringify(sortSerializable(snapshot));
}

export function snapshotHash(serializedSnapshot: string): string {
  let hash = 0;
  for (let index = 0; index < serializedSnapshot.length; index += 1) {
    hash = (hash * 31 + serializedSnapshot.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function snapshotPermanent(
  group: PermanentGroup,
  fallbackSessionId: string,
): LitePermanentSnapshot {
  const objectIds = group.session?.objectIds ?? [group.id];
  return {
    stableId: group.id,
    sessionId: group.session?.sessionId ?? fallbackSessionId,
    objectId: group.session?.objectId ?? objectIds[0] ?? group.id,
    objectIds,
    ownerParticipantId: group.session?.ownerParticipantId ?? "local",
    controllerParticipantId: group.session?.controllerParticipantId ?? "local",
    visibility: group.session?.visibility ?? "localOnly",
    synchronizationState: group.session?.synchronizationState ?? "localOnly",
    authoritySource: group.session?.authoritySource ?? "local-lite",
    label: group.label,
    cardIdentity: group.identity ? snapshotCardIdentity(group.identity) : null,
    printing: {
      setCode: group.identity?.setCode ?? null,
      collectorNumber: group.identity?.collectorNumber ?? null,
      scryfallId: group.identity?.cardId ?? null,
      oracleId: group.identity?.oracleId ?? null,
    },
    quantity: group.quantity,
    token: group.characteristics.isToken,
    genericPlaceholder: group.isGeneric,
    trackingEnabled: group.trackingEnabled,
    depowerState: {
      abilitiesActive: group.abilitiesActive,
      mode: group.depowerMode,
      disabledAbilities: [...group.disabledAbilities].sort(),
    },
    controller: group.controller,
    owner: group.owner,
    position: group.order,
    zone: group.zone,
    attachments: [...group.attachments].sort(),
    attachedTo: group.attachedTo,
    counters: sortNumberRecord(group.counters),
    basePowerToughness: {
      printedPower: group.pt.printedPower,
      printedToughness: group.pt.printedToughness,
      basePower: group.pt.basePower,
      baseToughness: group.pt.baseToughness,
    },
    currentPowerToughness: {
      currentPower: group.pt.currentPower,
      currentToughness: group.pt.currentToughness,
      temporaryPower: group.pt.temporaryPower,
      temporaryToughness: group.pt.temporaryToughness,
      staticPower: group.pt.staticPower,
      staticToughness: group.pt.staticToughness,
      powerToughnessSwitch: group.pt.powerToughnessSwitch,
      damage: group.pt.damage,
    },
    temporaryEffects: [],
    transformState: {
      transformed: group.statuses.transformed,
      originalIdentity: group.originalIdentity
        ? snapshotCardIdentity(group.originalIdentity)
        : null,
      originalCharacteristics: group.originalCharacteristics
        ? {
            ...group.originalCharacteristics,
            supertypes: [...group.originalCharacteristics.supertypes].sort(),
            cardTypes: [...group.originalCharacteristics.cardTypes].sort(),
            subtypes: [...group.originalCharacteristics.subtypes].sort(),
            colors: [...group.originalCharacteristics.colors].sort(),
          }
        : null,
    },
    statusFlags: { ...group.statuses },
    characteristics: {
      ...group.characteristics,
      supertypes: [...group.characteristics.supertypes].sort(),
      cardTypes: [...group.characteristics.cardTypes].sort(),
      subtypes: [...group.characteristics.subtypes].sort(),
      colors: [...group.characteristics.colors].sort(),
    },
    stackMembership: {
      stackKey: group.stackKey,
      quantity: group.quantity,
    },
  };
}

function snapshotCardIdentity(
  card: CardIdentity | CardIdentityLike,
): LiteCardIdentitySnapshot {
  return {
    cardId: card.cardId,
    oracleId: card.oracleId ?? null,
    name: card.name,
    manaCost: card.manaCost,
    manaValue: card.manaValue,
    typeLine: card.typeLine,
    oracleText: card.oracleText,
    setCode: card.setCode ?? null,
    collectorNumber: card.collectorNumber ?? null,
    colors: [...card.colors].sort(),
    colorIdentity: [...card.colorIdentity].sort(),
    keywords: [...card.keywords].sort(),
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    defense: card.defense,
    isToken: card.isToken,
    supportStatus: card.supportStatus,
  };
}

function sortNumberRecord<T extends string>(
  record: Record<T, number>,
): Record<T, number> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
  ) as Record<T, number>;
}

function sortBooleanRecord(
  record: Record<string, boolean>,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function sortStringArrayRecord(
  record: Record<string, string[]>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, [...value].sort()]),
  );
}

function sortSerializable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortSerializable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortSerializable(entry)]),
  );
}
