import { createGenericGroup, makeId, mergeCompatibleStacks } from "./cards";
import type {
  FieldState,
  OpponentValues,
  PermanentGroup,
  PlayerCounters,
  PlayerState,
  PlayerStatuses,
  RelevantTotal,
  RelevantTotalKey,
  SettingsState,
  WatcherPreferences,
  Zone,
} from "./types";

export const TOTAL_LABELS: Record<RelevantTotalKey, string> = {
  lands: "Lands",
  basicLands: "Basic lands",
  nonbasicLands: "Nonbasic",
  plains: "Plains",
  islands: "Islands",
  swamps: "Swamps",
  mountains: "Mountains",
  forests: "Forests",
  gates: "Gates",
  deserts: "Deserts",
  caves: "Caves",
  loci: "Loci",
  spheres: "Spheres",
  creatures: "Creatures",
  artifacts: "Artifacts",
  equipment: "Equipment",
  enchantments: "Enchantments",
  auras: "Auras",
  vehicles: "Vehicles",
  planeswalkers: "Planeswalkers",
  battles: "Battles",
  legendaryPermanents: "Legendary",
  tokens: "Tokens",
  nontokenPermanents: "Nontoken",
  treasureTokens: "Treasure",
  clueTokens: "Clue",
  foodTokens: "Food",
  bloodTokens: "Blood",
  mapTokens: "Map",
  powerstones: "Powerstone",
  cardsInHand: "Hand",
  cardsInGraveyard: "Graveyard",
  cardsInExile: "Exile",
  cardsRemainingInLibrary: "Library",
  commanderCasts: "Commander casts",
  custom: "Custom",
};

export const DEFAULT_PINNED_TOTALS: RelevantTotalKey[] = [
  "lands",
  "nonbasicLands",
  "artifacts",
  "cardsInHand",
  "cardsInExile",
];

export function createDefaultField(): FieldState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: makeId("field"),
    name: "Baord State Lite Field",
    createdAt: now,
    updatedAt: now,
    player: createDefaultPlayer(40),
    opponentValues: createDefaultOpponentValues(),
    groups: [
      createGenericGroup({
        kind: "Land",
        label: "Generic lands",
        quantity: 8,
        zone: "battlefield",
      }),
    ],
    pinnedTotals: DEFAULT_PINNED_TOTALS,
    customEffects: [],
    settings: createDefaultSettings(),
    watcherPreferences: createDefaultWatcherPreferences(),
    orderingPreferences: {},
    optionalPreferences: {},
    recentSearches: [],
    recentCards: [],
  };
}

export function createDefaultPlayer(startingLife: number): PlayerState {
  return {
    life: startingLife,
    startingLife,
    counters: createDefaultCounters(),
    statuses: createDefaultStatuses(),
  };
}

export function createDefaultCounters(): PlayerCounters {
  return {
    poison: 0,
    energy: 0,
    experience: 0,
    rad: 0,
    commanderDamage: 0,
    custom: {},
  };
}

export function createDefaultStatuses(): PlayerStatuses {
  return {
    monarch: false,
    initiative: false,
    citysBlessing: false,
    dayNight: "off",
  };
}

export function createDefaultOpponentValues(): OpponentValues {
  return {
    opponentCreatures: 0,
    opponentArtifacts: 0,
    opponentCardsInHand: 0,
    opponentGraveyardCards: 0,
    opponentPermanents: 0,
    opponentsWhoLostLife: 0,
    numberOfOpponents: 3,
    highestOpponentLife: 40,
    lowestOpponentLife: 40,
    custom: {},
  };
}

export function createDefaultSettings(): SettingsState {
  return {
    startingLife: 40,
    cardSize: "standard",
    tappedStyle: "rotate",
    animationSpeed: "normal",
    reducedMotion: false,
    backgroundWatchers: true,
    optionalEffects: "ask",
    triggerOrdering: "ask-when-needed",
    themeAccent: "verdant",
    sound: false,
    haptics: true,
  };
}

export function createDefaultWatcherPreferences(): WatcherPreferences {
  return {
    landEntryMode: "ask",
    creatureEntryMode: "ask",
    artifactEntryMode: "ask",
  };
}

export function sanitizeImportedField(value: unknown): FieldState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<FieldState>;
  if (
    candidate.schemaVersion !== 1 ||
    !Array.isArray(candidate.groups) ||
    !candidate.player
  ) {
    return null;
  }
  const defaults = createDefaultField();
  return {
    ...defaults,
    ...candidate,
    id: typeof candidate.id === "string" ? candidate.id : defaults.id,
    name: sanitizeText(candidate.name, "Imported Baord State Lite Field"),
    player: {
      ...defaults.player,
      ...candidate.player,
      life: clampNumber(candidate.player.life, 0, 999999, defaults.player.life),
      startingLife: clampNumber(
        candidate.player.startingLife,
        1,
        999999,
        defaults.player.startingLife,
      ),
      counters: {
        ...defaults.player.counters,
        ...candidate.player.counters,
        custom: sanitizeNumberRecord(candidate.player.counters?.custom),
      },
      statuses: {
        ...defaults.player.statuses,
        ...candidate.player.statuses,
      },
    },
    opponentValues: {
      ...defaults.opponentValues,
      ...candidate.opponentValues,
      custom: sanitizeNumberRecord(candidate.opponentValues?.custom),
    },
    groups: candidate.groups
      .filter((group): group is PermanentGroup =>
        Boolean(group && typeof group.id === "string"),
      )
      .map((group, index) => ({
        ...group,
        label: sanitizeText(group.label, "Imported object"),
        notes: sanitizeText(group.notes, ""),
        quantity: clampNumber(group.quantity, 1, 999999999, 1),
        order: Number.isFinite(group.order) ? group.order : index,
      })),
    pinnedTotals: Array.isArray(candidate.pinnedTotals)
      ? candidate.pinnedTotals
      : defaults.pinnedTotals,
    recentSearches: Array.isArray(candidate.recentSearches)
      ? candidate.recentSearches
          .map((entry) => sanitizeText(entry, ""))
          .filter(Boolean)
      : [],
    recentCards: Array.isArray(candidate.recentCards)
      ? candidate.recentCards.slice(0, 20)
      : [],
    updatedAt: new Date().toISOString(),
  };
}

export function getVisibleTotals(field: FieldState): RelevantTotal[] {
  const aggregate = calculateTotals(field.groups);
  const required = new Set<RelevantTotalKey>(field.pinnedTotals);

  for (const group of field.groups) {
    const oracle = group.identity?.oracleText.toLowerCase() ?? "";
    if (oracle.includes("artifact")) required.add("artifacts");
    if (oracle.includes("creature")) required.add("creatures");
    if (oracle.includes("land")) required.add("lands");
    if (oracle.includes("equipment")) required.add("equipment");
    if (oracle.includes("token")) required.add("tokens");
    if (oracle.includes("graveyard")) required.add("cardsInGraveyard");
    if (oracle.includes("exile")) required.add("cardsInExile");
  }

  return [...required].map((key) => ({
    key,
    label: TOTAL_LABELS[key],
    value: aggregate[key] ?? 0,
    required: !field.pinnedTotals.includes(key),
    zone: zoneForTotal(key),
  }));
}

export function calculateTotals(
  groups: PermanentGroup[],
): Record<RelevantTotalKey, number> {
  const totals = Object.keys(TOTAL_LABELS).reduce(
    (acc, key) => ({ ...acc, [key]: 0 }),
    {} as Record<RelevantTotalKey, number>,
  );

  for (const group of groups) {
    const quantity = group.quantity;
    const types = new Set(group.characteristics.cardTypes);
    const subtypes = new Set(group.characteristics.subtypes);
    const supertypes = new Set(group.characteristics.supertypes);

    if (group.zone === "hand") totals.cardsInHand += quantity;
    if (group.zone === "graveyard") totals.cardsInGraveyard += quantity;
    if (group.zone === "exile") totals.cardsInExile += quantity;
    if (group.zone === "library") totals.cardsRemainingInLibrary += quantity;
    if (group.zone !== "battlefield") continue;

    if (types.has("Land")) totals.lands += quantity;
    if (types.has("Land") && supertypes.has("Basic"))
      totals.basicLands += quantity;
    if (types.has("Land") && !supertypes.has("Basic"))
      totals.nonbasicLands += quantity;
    if (subtypes.has("Plains")) totals.plains += quantity;
    if (subtypes.has("Island")) totals.islands += quantity;
    if (subtypes.has("Swamp")) totals.swamps += quantity;
    if (subtypes.has("Mountain")) totals.mountains += quantity;
    if (subtypes.has("Forest")) totals.forests += quantity;
    if (subtypes.has("Gate")) totals.gates += quantity;
    if (subtypes.has("Desert")) totals.deserts += quantity;
    if (subtypes.has("Cave")) totals.caves += quantity;
    if (subtypes.has("Locus")) totals.loci += quantity;
    if (subtypes.has("Sphere")) totals.spheres += quantity;

    if (types.has("Creature")) totals.creatures += quantity;
    if (types.has("Artifact")) totals.artifacts += quantity;
    if (subtypes.has("Equipment")) totals.equipment += quantity;
    if (types.has("Enchantment")) totals.enchantments += quantity;
    if (subtypes.has("Aura")) totals.auras += quantity;
    if (subtypes.has("Vehicle")) totals.vehicles += quantity;
    if (types.has("Planeswalker")) totals.planeswalkers += quantity;
    if (types.has("Battle")) totals.battles += quantity;
    if (group.characteristics.isLegendary)
      totals.legendaryPermanents += quantity;
    if (group.characteristics.isToken) totals.tokens += quantity;
    if (!group.characteristics.isToken) totals.nontokenPermanents += quantity;
    if (group.characteristics.isToken && subtypes.has("Treasure"))
      totals.treasureTokens += quantity;
    if (group.characteristics.isToken && subtypes.has("Clue"))
      totals.clueTokens += quantity;
    if (group.characteristics.isToken && subtypes.has("Food"))
      totals.foodTokens += quantity;
    if (group.characteristics.isToken && subtypes.has("Blood"))
      totals.bloodTokens += quantity;
    if (group.characteristics.isToken && subtypes.has("Map"))
      totals.mapTokens += quantity;
    if (subtypes.has("Powerstone")) totals.powerstones += quantity;
  }

  return totals;
}

export function normalizeField(field: FieldState): FieldState {
  return {
    ...field,
    groups: mergeCompatibleStacks(field.groups),
    updatedAt: new Date().toISOString(),
  };
}

export function sanitizeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  return (
    value
      .replace(/[<>{}`]/g, "")
      .trim()
      .slice(0, 120) || fallback
  );
}

function sanitizeNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.entries(value).reduce<Record<string, number>>(
    (acc, [key, entry]) => {
      acc[sanitizeText(key, "Counter")] = clampNumber(entry, 0, 999999999, 0);
      return acc;
    },
    {},
  );
}

export function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function zoneForTotal(key: RelevantTotalKey): Zone | undefined {
  if (key === "cardsInHand") return "hand";
  if (key === "cardsInGraveyard") return "graveyard";
  if (key === "cardsInExile") return "exile";
  if (key === "cardsRemainingInLibrary") return "library";
  return undefined;
}
