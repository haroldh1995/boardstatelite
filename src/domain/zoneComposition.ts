import {
  createCardGroup,
  createGenericGroup,
  splitGroupForQuantity,
  withStackKey,
} from "./cards";
import type {
  CardIdentity,
  FieldState,
  PermanentGroup,
  RelevantTotalKey,
} from "./types";
import { nowMs } from "../platform/runtime";
import {
  ATHENA_STATIC_EFFECT_DEFINITIONS,
  getAthenaStaticEffectDefinitionsForCard,
} from "./staticEffects";
import {
  ZONE_COMPOSITION_COLLECTION_VERSION,
  ZONE_COMPOSITION_VERSION,
  type CategoricalZone,
  type ZoneCategoryKey,
  type ZoneCategoryRelevantTotalKey,
  type ZoneCategorySnapshot,
  type ZoneCommanderIdentity,
  type ZoneCompositionCollectionState,
  type ZoneCompositionCommandResult,
  type ZoneCompositionCorrectionInput,
  type ZoneCompositionSnapshot,
  type ZoneCompositionState,
  type ZoneDeckSnapshotCard,
} from "./zoneCompositionTypes";

const MAX_ZONE_VALUE = 999_999_999;
const COLORS = ["white", "blue", "black", "red", "green"] as const;
const COLOR_CODES: Record<(typeof COLORS)[number], string> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};
const COLOR_NAMES = Object.fromEntries(
  Object.entries(COLOR_CODES).map(([name, code]) => [code, name]),
) as Record<string, (typeof COLORS)[number]>;

export const ZONE_CARD_TYPE_CATEGORIES: readonly ZoneCategoryKey[] = [
  "creature",
  "artifact",
  "enchantment",
  "instant",
  "sorcery",
  "land",
  "planeswalker",
  "battle",
  "kindred",
];

export const ZONE_CHARACTERISTIC_CATEGORIES: readonly ZoneCategoryKey[] = [
  "legendary",
  "token",
  "nontoken",
  "commander",
  "historic",
];

export const ZONE_COLOR_CATEGORIES: readonly ZoneCategoryKey[] = [
  ...COLORS,
  "colorless",
  "multicolor",
];

export const DEFAULT_ZONE_CATEGORY_KEYS: readonly ZoneCategoryKey[] = [
  ...ZONE_CARD_TYPE_CATEGORIES,
  ...ZONE_CHARACTERISTIC_CATEGORIES,
  ...ZONE_COLOR_CATEGORIES,
];

export interface ZoneCategoryOptions {
  prioritized: ZoneCategoryKey[];
  additional: ZoneCategoryKey[];
  manualColors: ZoneCategoryKey[];
}

export function createDefaultZoneCompositionCollection(
  timestamp = isoNow(),
): ZoneCompositionCollectionState {
  return {
    version: ZONE_COMPOSITION_COLLECTION_VERSION,
    commander: null,
    graveyard: createDefaultZoneComposition("graveyard", timestamp),
    exile: createDefaultZoneComposition("exile", timestamp),
  };
}

export function createDefaultZoneComposition(
  zone: CategoricalZone,
  timestamp = isoNow(),
): ZoneCompositionState {
  return {
    version: ZONE_COMPOSITION_VERSION,
    zone,
    manualMemberships: {},
    exactCategoryKeys: [],
    manuallyAccountedPhysicalCards: 0,
    unknownPhysicalCardsAtUpdate: 0,
    trackedCategoryKeys: [],
    authorityCategoryTotals: {},
    updatedAt: timestamp,
  };
}

export function normalizeZoneCompositionCollection(
  value: unknown,
  groups: readonly PermanentGroup[],
  timestamp = isoNow(),
): ZoneCompositionCollectionState {
  const candidate = objectRecord(value);
  const commander = normalizeCommander(candidate?.commander, timestamp);
  const collection = {
    version: ZONE_COMPOSITION_COLLECTION_VERSION,
    commander,
    graveyard: normalizeZoneCompositionState(
      candidate?.graveyard,
      "graveyard",
      groups,
      timestamp,
    ),
    exile: normalizeZoneCompositionState(
      candidate?.exile,
      "exile",
      groups,
      timestamp,
    ),
  } satisfies ZoneCompositionCollectionState;
  return clampCollectionMemberships(
    inferCommanderFromGroups(collection, groups, timestamp),
    groups,
  );
}

export function normalizeZoneCompositionState(
  value: unknown,
  zone: CategoricalZone,
  groups: readonly PermanentGroup[],
  timestamp = isoNow(),
): ZoneCompositionState {
  const candidate = objectRecord(value);
  const manualMemberships = sanitizeCategoryNumberRecord(
    candidate?.manualMemberships,
  );
  const exactCategoryKeys = sanitizeCategoryKeys(candidate?.exactCategoryKeys);
  const trackedCategoryKeys = sanitizeCategoryKeys(
    candidate?.trackedCategoryKeys,
  );
  const authorityCategoryTotals = sanitizeAuthorityTotals(
    candidate?.authorityCategoryTotals,
    timestamp,
  );
  const physicalTotal = physicalTotalForZone(groups, zone);
  const knownPhysicalCards = knownPhysicalCardsForZone(groups, zone);
  const unknownPhysicalCards = Math.max(0, physicalTotal - knownPhysicalCards);
  const unknownPhysicalCardsAtUpdate = clampInteger(
    candidate?.unknownPhysicalCardsAtUpdate,
    0,
    MAX_ZONE_VALUE,
    unknownPhysicalCards,
  );
  return {
    version: ZONE_COMPOSITION_VERSION,
    zone,
    manualMemberships,
    exactCategoryKeys:
      unknownPhysicalCardsAtUpdate === unknownPhysicalCards
        ? uniqueSortedCategoryKeys(exactCategoryKeys)
        : [],
    manuallyAccountedPhysicalCards: clampInteger(
      candidate?.manuallyAccountedPhysicalCards,
      0,
      unknownPhysicalCards,
      0,
    ),
    unknownPhysicalCardsAtUpdate: unknownPhysicalCards,
    trackedCategoryKeys: uniqueSortedCategoryKeys([
      ...trackedCategoryKeys,
      ...Object.keys(manualMemberships),
      ...Object.keys(authorityCategoryTotals),
    ]),
    authorityCategoryTotals,
    updatedAt:
      typeof candidate?.updatedAt === "string"
        ? candidate.updatedAt
        : timestamp,
  };
}

export function getZoneCompositionSnapshot(
  field: Pick<FieldState, "groups" | "zoneCompositions">,
  zone: CategoricalZone,
  options: {
    deckSnapshot?: readonly ZoneDeckSnapshotCard[];
    requestedCategoryKeys?: readonly ZoneCategoryKey[];
  } = {},
): ZoneCompositionSnapshot {
  const state = field.zoneCompositions[zone];
  const groups = field.groups.filter((group) => group.zone === zone);
  const physicalTotal = groups.reduce((sum, group) => sum + group.quantity, 0);
  const knownGroups = groups.filter((group) => Boolean(group.identity));
  const knownPhysicalCards = knownGroups.reduce(
    (sum, group) => sum + group.quantity,
    0,
  );
  const maximumManuallyAccounted = Math.max(
    0,
    physicalTotal - knownPhysicalCards,
  );
  const manuallyAccountedPhysicalCards = Math.min(
    maximumManuallyAccounted,
    state.manuallyAccountedPhysicalCards,
  );
  const accountedPhysicalCards = Math.min(
    physicalTotal,
    knownPhysicalCards + manuallyAccountedPhysicalCards,
  );
  const unaccountedPhysicalCards = Math.max(
    0,
    physicalTotal - accountedPhysicalCards,
  );
  const knownTotals = knownCategoryTotals(
    knownGroups,
    field.zoneCompositions.commander,
  );
  const materializedKeys = materializedCategoryKeys({
    knownTotals,
    state,
    deckSnapshot: options.deckSnapshot,
    requestedCategoryKeys: options.requestedCategoryKeys,
  });
  const categories = materializedKeys.map((key) => {
    const knownValue = knownTotals[key] ?? 0;
    const manualValue = state.manualMemberships[key] ?? 0;
    const authority = state.authorityCategoryTotals[key];
    const localValue = safeAdd(knownValue, manualValue);
    const value = authority?.value ?? localValue;
    const exact =
      Boolean(authority) ||
      state.exactCategoryKeys.includes(key) ||
      knownPhysicalCards === physicalTotal;
    return {
      key,
      dependencyKey: zoneCategoryRelevantTotalKey(zone, key),
      label: zoneCategoryLabel(key),
      kind: zoneCategoryKind(key),
      value,
      knownValue,
      manualValue,
      exact,
      status: exact ? "exact" : "partial",
      authoritySource: authority
        ? "boardstate-authority"
        : manualValue > 0 || state.exactCategoryKeys.includes(key)
          ? "manual-correction"
          : "local-canonical",
      authorityReference: authority?.reference ?? null,
    } satisfies ZoneCategorySnapshot;
  });
  const categoryTotals = Object.fromEntries(
    categories.map((category) => [category.key, category.value]),
  ) as Partial<Record<ZoneCategoryKey, number>>;
  return {
    version: ZONE_COMPOSITION_VERSION,
    zone,
    physicalTotal,
    knownPhysicalCards,
    manuallyAccountedPhysicalCards,
    accountedPhysicalCards,
    unaccountedPhysicalCards,
    categories,
    categoryTotals,
    exactCategoryKeys: categories
      .filter((category) => category.exact)
      .map((category) => category.key),
    partialCategoryKeys: categories
      .filter((category) => !category.exact)
      .map((category) => category.key),
    authoritativeCategoryKeys: categories
      .filter((category) => category.authoritySource === "boardstate-authority")
      .map((category) => category.key),
    dynamicSubtypeKeys: categories
      .filter((category) => category.kind === "subtype")
      .map((category) => category.key),
    completelyAccounted:
      unaccountedPhysicalCards === 0 &&
      categories.every((category) => category.exact),
    semanticDescription: `${zoneCategoryLabel(zone)} contains ${physicalTotal} cards. ${unaccountedPhysicalCards} cards are unaccounted for.`,
  };
}

export function zoneCategoryRelevantTotals(
  field: Pick<FieldState, "groups" | "zoneCompositions">,
  requestedTotals: readonly RelevantTotalKey[] = [],
): Partial<Record<RelevantTotalKey, number>> {
  const totals: Partial<Record<RelevantTotalKey, number>> = {};
  for (const zone of ["graveyard", "exile"] as const) {
    const snapshot = getZoneCompositionSnapshot(field, zone, {
      requestedCategoryKeys: requestedTotals
        .map((total) => zoneCategoryFromRelevantTotal(total, zone))
        .filter((key): key is ZoneCategoryKey => Boolean(key)),
    });
    for (const category of snapshot.categories) {
      totals[category.dependencyKey] = category.value;
    }
  }
  return totals;
}

export function zoneCategoryReliability(
  field: Pick<FieldState, "groups" | "zoneCompositions">,
  requestedTotals: readonly RelevantTotalKey[] = [],
): Map<ZoneCategoryRelevantTotalKey, ZoneCategorySnapshot> {
  const result = new Map<ZoneCategoryRelevantTotalKey, ZoneCategorySnapshot>();
  for (const zone of ["graveyard", "exile"] as const) {
    const requestedCategoryKeys = requestedTotals
      .map((total) => zoneCategoryFromRelevantTotal(total, zone))
      .filter((key): key is ZoneCategoryKey => Boolean(key));
    for (const category of getZoneCompositionSnapshot(field, zone, {
      requestedCategoryKeys,
    }).categories) {
      result.set(category.dependencyKey, category);
    }
  }
  return result;
}

export function applyZoneCompositionCorrection(
  field: FieldState,
  input: ZoneCompositionCorrectionInput,
): ZoneCompositionCommandResult<FieldState> {
  const timestamp = input.timestamp ?? isoNow();
  let working = field;
  const beforeSnapshot = getZoneCompositionSnapshot(field, input.zone, {
    requestedCategoryKeys: Object.keys(input.categoryTotals ?? {}).filter(
      isZoneCategoryKey,
    ),
  });
  if (input.physicalTotal !== undefined) {
    const physical = setZonePhysicalTotal(
      working,
      input.zone,
      input.physicalTotal,
    );
    if (!physical.ok) return failedCommand(field, physical.reason);
    working = physical.field;
  }
  const state = working.zoneCompositions[input.zone];
  const manualMemberships = { ...state.manualMemberships };
  const currentSnapshot = getZoneCompositionSnapshot(working, input.zone, {
    requestedCategoryKeys: Object.keys(input.categoryTotals ?? {}).filter(
      isZoneCategoryKey,
    ),
  });
  const exactCategoryKeys = new Set(
    beforeSnapshot.physicalTotal === currentSnapshot.physicalTotal
      ? state.exactCategoryKeys
      : [],
  );
  const trackedCategoryKeys = new Set(state.trackedCategoryKeys);
  const changedCategoryKeys: ZoneCategoryKey[] = [];
  for (const category of currentSnapshot.categories) {
    const existing = manualMemberships[category.key];
    if (existing === undefined) continue;
    const maximum = Math.max(
      0,
      currentSnapshot.physicalTotal - category.knownValue,
    );
    const next = Math.min(existing, maximum);
    if (next === 0) delete manualMemberships[category.key];
    else manualMemberships[category.key] = next;
  }
  const categoriesByKey = new Map(
    currentSnapshot.categories.map((category) => [category.key, category]),
  );
  for (const [rawKey, rawValue] of Object.entries(input.categoryTotals ?? {})) {
    if (!isZoneCategoryKey(rawKey)) {
      return failedCommand(field, "The category key is invalid.");
    }
    const desired = safeZoneValue(rawValue);
    if (desired === null) {
      return failedCommand(
        field,
        "Zone category totals cannot be negative or invalid.",
      );
    }
    const category = categoriesByKey.get(rawKey);
    const knownValue = category?.knownValue ?? 0;
    const authoritative = state.authorityCategoryTotals[rawKey];
    if (authoritative && desired !== authoritative.value) {
      return failedCommand(
        field,
        "BoardState authoritative category information cannot be overwritten by a local correction.",
      );
    }
    if (desired < knownValue) {
      return failedCommand(
        field,
        "A manual category total cannot be lower than known canonical card membership.",
      );
    }
    if (desired > currentSnapshot.physicalTotal) {
      return failedCommand(
        field,
        "A category membership cannot exceed the physical card total for its zone.",
      );
    }
    manualMemberships[rawKey] = desired - knownValue;
    if (manualMemberships[rawKey] === 0) delete manualMemberships[rawKey];
    exactCategoryKeys.add(rawKey);
    trackedCategoryKeys.add(rawKey);
    changedCategoryKeys.push(rawKey);
  }
  for (const key of input.selectedCategoryKeys ?? []) {
    if (isZoneCategoryKey(key)) trackedCategoryKeys.add(key);
  }
  const updatedSnapshot = getZoneCompositionSnapshot(working, input.zone);
  const maximumManuallyAccounted = Math.max(
    0,
    updatedSnapshot.physicalTotal - updatedSnapshot.knownPhysicalCards,
  );
  const manuallyAccountedPhysicalCards =
    input.manuallyAccountedPhysicalCards === undefined
      ? Math.min(state.manuallyAccountedPhysicalCards, maximumManuallyAccounted)
      : safeZoneValue(input.manuallyAccountedPhysicalCards);
  if (
    manuallyAccountedPhysicalCards === null ||
    manuallyAccountedPhysicalCards > maximumManuallyAccounted
  ) {
    return failedCommand(
      field,
      "Accounted physical cards must fit within the unknown portion of the zone.",
    );
  }
  working = {
    ...working,
    zoneCompositions: {
      ...working.zoneCompositions,
      [input.zone]: {
        ...state,
        manualMemberships,
        exactCategoryKeys: uniqueSortedCategoryKeys([...exactCategoryKeys]),
        manuallyAccountedPhysicalCards,
        unknownPhysicalCardsAtUpdate: Math.max(
          0,
          currentSnapshot.physicalTotal - currentSnapshot.knownPhysicalCards,
        ),
        trackedCategoryKeys: uniqueSortedCategoryKeys([...trackedCategoryKeys]),
        updatedAt: timestamp,
      },
    },
  };
  const afterSnapshot = getZoneCompositionSnapshot(working, input.zone, {
    requestedCategoryKeys: changedCategoryKeys,
  });
  const summary = compositionCorrectionSummary(
    input.zone,
    beforeSnapshot,
    afterSnapshot,
    changedCategoryKeys,
  );
  return successfulCommand(working, summary, changedCategoryKeys);
}

export function reconcileUnknownZoneGroupIdentity(
  field: FieldState,
  input: {
    groupId: string;
    card: CardIdentity;
    quantity?: number;
    source?: "scryfall-reconciliation" | "deck-snapshot";
    timestamp?: string;
  },
): ZoneCompositionCommandResult<FieldState> {
  const original = field.groups.find((group) => group.id === input.groupId);
  if (!original || !isCategoricalZone(original.zone)) {
    return failedCommand(field, "The unaccounted zone record was not found.");
  }
  const zone = original.zone;
  if (original.identity) {
    return failedCommand(
      field,
      "The zone record already has a known identity.",
    );
  }
  const quantity = Math.max(
    1,
    Math.min(
      original.quantity,
      Math.trunc(input.quantity ?? original.quantity),
    ),
  );
  const split = splitGroupForQuantity(field.groups, original.id, quantity);
  const targetId = split.targetId;
  if (!targetId)
    return failedCommand(field, "The zone record could not be split.");
  const target = split.groups.find((group) => group.id === targetId);
  if (!target)
    return failedCommand(field, "The zone record could not be identified.");
  const identified = createCardGroup(input.card, target.quantity, target.zone);
  const replacement = withStackKey({
    ...identified,
    id: target.id,
    session: target.session,
    owner: target.owner,
    controller: target.controller,
    order: target.order,
    notes: target.notes,
    trackingEnabled: target.trackingEnabled,
  });
  const commander = field.zoneCompositions.commander;
  const classification = classifyGroup(replacement, commander);
  const state = field.zoneCompositions[zone];
  const manualMemberships = { ...state.manualMemberships };
  for (const key of classification) {
    const existing = manualMemberships[key] ?? 0;
    if (existing <= 0) continue;
    const next = Math.max(0, existing - target.quantity);
    if (next === 0) delete manualMemberships[key];
    else manualMemberships[key] = next;
  }
  const timestamp = input.timestamp ?? isoNow();
  const knownPhysicalCards = knownPhysicalCardsForZone(
    split.groups.map((group) => (group.id === targetId ? replacement : group)),
    zone,
  );
  const next: FieldState = {
    ...field,
    groups: split.groups.map((group) =>
      group.id === targetId ? replacement : group,
    ),
    zoneCompositions: {
      ...field.zoneCompositions,
      [zone]: {
        ...state,
        manualMemberships,
        manuallyAccountedPhysicalCards: Math.max(
          0,
          state.manuallyAccountedPhysicalCards - target.quantity,
        ),
        unknownPhysicalCardsAtUpdate: Math.max(
          0,
          physicalTotalForZone(split.groups, zone) - knownPhysicalCards,
        ),
        trackedCategoryKeys: uniqueSortedCategoryKeys([
          ...state.trackedCategoryKeys,
          ...classification,
        ]),
        updatedAt: timestamp,
      },
    },
  };
  return successfulCommand(
    next,
    [
      `${input.card.name} was identified in ${zone}; its physical card count did not change.`,
    ],
    classification,
  );
}

export function reconcileZoneGroupFromDeckSnapshot(
  field: FieldState,
  input: {
    groupId: string;
    cardId: string;
    deckSnapshot: readonly ZoneDeckSnapshotCard[];
    timestamp?: string;
  },
): ZoneCompositionCommandResult<FieldState> {
  const card = input.deckSnapshot.find(
    (entry) => entry.cardId === input.cardId,
  );
  if (!card)
    return failedCommand(
      field,
      "The card was not found in the active deck snapshot.",
    );
  const identity = cardIdentityFromDeckSnapshot(card);
  return reconcileUnknownZoneGroupIdentity(field, {
    groupId: input.groupId,
    card: identity,
    source: "deck-snapshot",
    timestamp: input.timestamp,
  });
}

export function applyDeckSnapshotZoneContext(
  field: FieldState,
  deckSnapshot: readonly ZoneDeckSnapshotCard[],
  timestamp = isoNow(),
): FieldState {
  const commanderCard = deckSnapshot.find((card) => card.isCommander);
  const commander = commanderCard
    ? commanderIdentityFromDeckCard(commanderCard, timestamp)
    : field.zoneCompositions.commander;
  const trackedCategoryKeys = deckSnapshot.flatMap((card) =>
    classifyDeckSnapshotCard(card, commander),
  );
  return {
    ...field,
    zoneCompositions: {
      ...field.zoneCompositions,
      commander,
      graveyard: {
        ...field.zoneCompositions.graveyard,
        trackedCategoryKeys: uniqueSortedCategoryKeys([
          ...field.zoneCompositions.graveyard.trackedCategoryKeys,
          ...trackedCategoryKeys,
        ]),
        updatedAt: timestamp,
      },
      exile: {
        ...field.zoneCompositions.exile,
        trackedCategoryKeys: uniqueSortedCategoryKeys([
          ...field.zoneCompositions.exile.trackedCategoryKeys,
          ...trackedCategoryKeys,
        ]),
        updatedAt: timestamp,
      },
    },
  };
}

export function setActiveCommanderIdentity(
  field: FieldState,
  card: Pick<CardIdentity, "cardId" | "name" | "colorIdentity">,
  source: ZoneCommanderIdentity["source"] = "canonical-card",
  timestamp = isoNow(),
): FieldState {
  return {
    ...field,
    zoneCompositions: {
      ...field.zoneCompositions,
      commander: {
        cardId: card.cardId,
        name: card.name,
        colorIdentity: normalizeColorCodes(card.colorIdentity),
        source,
        updatedAt: timestamp,
      },
    },
  };
}

export function manualZoneColorOptions(
  field: Pick<FieldState, "groups" | "zoneCompositions">,
  deckSnapshot: readonly ZoneDeckSnapshotCard[] = [],
): ZoneCategoryKey[] {
  const commander =
    field.zoneCompositions.commander ??
    commanderFromDeckSnapshot(deckSnapshot) ??
    inferredCommanderFromGroups(field.groups, isoNow());
  if (!commander) return [...COLORS, "colorless"];
  const allowed = new Set(
    normalizeColorCodes(commander.colorIdentity).map(
      (color) => COLOR_NAMES[color],
    ),
  );
  return [...COLORS.filter((color) => allowed.has(color)), "colorless"];
}

export function getZoneCategoryOptions(
  field: FieldState,
  zone: CategoricalZone,
  deckSnapshot: readonly ZoneDeckSnapshotCard[] = [],
): ZoneCategoryOptions {
  const snapshot = getZoneCompositionSnapshot(field, zone, { deckSnapshot });
  const relevant = new Set<ZoneCategoryKey>();
  for (const group of field.groups) {
    if (group.zone !== "battlefield" || !group.identity) continue;
    for (const definition of getAthenaStaticEffectDefinitionsForCard(
      group.identity.name,
      ATHENA_STATIC_EFFECT_DEFINITIONS,
    )) {
      for (const total of definition.reads) {
        const category = zoneCategoryFromRelevantTotal(total, zone);
        if (category) relevant.add(category);
      }
    }
  }
  const state = field.zoneCompositions[zone];
  for (const key of state.trackedCategoryKeys) relevant.add(key);
  for (const category of snapshot.categories) {
    if (category.value > 0) relevant.add(category.key);
  }
  const manualColors = manualZoneColorOptions(field, deckSnapshot);
  const deckCategories = new Set(
    deckSnapshot
      .flatMap((card) =>
        classifyDeckSnapshotCard(card, field.zoneCompositions.commander),
      )
      .filter(
        (key) =>
          zoneCategoryKind(key) !== "color" ||
          key === "multicolor" ||
          manualColors.includes(key),
      ),
  );
  const available = uniqueSortedCategoryKeys([
    ...ZONE_CARD_TYPE_CATEGORIES,
    ...ZONE_CHARACTERISTIC_CATEGORIES,
    ...manualColors,
    "multicolor",
    ...snapshot.dynamicSubtypeKeys,
    ...deckCategories,
  ]);
  const prioritized = available.filter((key) => relevant.has(key));
  const additional = available.filter((key) => !relevant.has(key));
  return { prioritized, additional, manualColors };
}

export function applyAuthoritativeZoneCategoryTotals(
  field: FieldState,
  input: {
    zone: CategoricalZone;
    totals: Partial<Record<ZoneCategoryKey, number>>;
    reference: string;
    timestamp?: string;
  },
): FieldState {
  const timestamp = input.timestamp ?? isoNow();
  const state = field.zoneCompositions[input.zone];
  const authorityCategoryTotals = { ...state.authorityCategoryTotals };
  for (const [key, value] of Object.entries(input.totals)) {
    if (!isZoneCategoryKey(key)) continue;
    const safe = safeZoneValue(value);
    if (safe === null) continue;
    authorityCategoryTotals[key] = {
      value: safe,
      reference: input.reference,
      updatedAt: timestamp,
    };
  }
  return {
    ...field,
    zoneCompositions: {
      ...field.zoneCompositions,
      [input.zone]: {
        ...state,
        authorityCategoryTotals,
        trackedCategoryKeys: uniqueSortedCategoryKeys([
          ...state.trackedCategoryKeys,
          ...Object.keys(authorityCategoryTotals).filter(isZoneCategoryKey),
        ]),
        updatedAt: timestamp,
      },
    },
  };
}

export function classifyKnownZoneGroup(
  field: Pick<FieldState, "zoneCompositions">,
  group: PermanentGroup,
): ZoneCategoryKey[] {
  if (!group.identity || !isCategoricalZone(group.zone)) return [];
  return classifyGroup(group, field.zoneCompositions.commander);
}

export function zoneCategoryRelevantTotalKey(
  zone: CategoricalZone,
  key: ZoneCategoryKey,
): ZoneCategoryRelevantTotalKey {
  return `${zone}.${key}`;
}

export function zoneCategoryFromRelevantTotal(
  total: RelevantTotalKey,
  zone?: CategoricalZone,
): ZoneCategoryKey | null {
  const [prefix, ...rest] = total.split(".");
  if (!isCategoricalZone(prefix)) return null;
  if (zone && prefix !== zone) return null;
  const category = rest.join(".");
  return isZoneCategoryKey(category) ? category : null;
}

export function isZoneCategoryRelevantTotalKey(
  value: string,
): value is ZoneCategoryRelevantTotalKey {
  const [zone, ...rest] = value.split(".");
  return isCategoricalZone(zone) && isZoneCategoryKey(rest.join("."));
}

export function isZoneCategoryKey(value: unknown): value is ZoneCategoryKey {
  if (typeof value !== "string") return false;
  if ((DEFAULT_ZONE_CATEGORY_KEYS as readonly string[]).includes(value)) {
    return true;
  }
  return /^subtype:[a-z0-9][a-z0-9-]{0,79}$/.test(value);
}

export function zoneSubtypeCategory(subtype: string): ZoneCategoryKey | null {
  const normalized = subtype
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized ? `subtype:${normalized}` : null;
}

export function zoneCategoryLabel(
  key: ZoneCategoryKey | CategoricalZone,
): string {
  if (key === "graveyard") return "Graveyard";
  if (key === "exile") return "Exile";
  if (key.startsWith("subtype:")) {
    return titleCase(key.slice("subtype:".length).replaceAll("-", " "));
  }
  if (key === "nontoken") return "Nontoken";
  if (key === "multicolor") return "Multicolor";
  return titleCase(key);
}

function setZonePhysicalTotal(
  field: FieldState,
  zone: CategoricalZone,
  requestedTotal: number,
): { ok: true; field: FieldState } | { ok: false; reason: string } {
  const desired = safeZoneValue(requestedTotal);
  if (desired === null) {
    return { ok: false, reason: "Zone totals cannot be negative or invalid." };
  }
  const known = knownPhysicalCardsForZone(field.groups, zone);
  if (desired < known) {
    return {
      ok: false,
      reason:
        "The physical total cannot be lower than known cards in the zone.",
    };
  }
  const current = physicalTotalForZone(field.groups, zone);
  const delta = desired - current;
  if (delta === 0) return { ok: true, field };
  if (delta > 0) {
    const group = createGenericGroup({
      kind: "Custom",
      label: `Unaccounted ${zone} cards`,
      quantity: delta,
      zone,
    });
    return { ok: true, field: { ...field, groups: [...field.groups, group] } };
  }
  let remaining = Math.abs(delta);
  const groups = field.groups
    .map((group) => {
      if (group.zone !== zone || group.identity || remaining <= 0) return group;
      const removed = Math.min(group.quantity, remaining);
      remaining -= removed;
      return { ...group, quantity: group.quantity - removed };
    })
    .filter((group) => group.quantity > 0);
  if (remaining > 0) {
    return {
      ok: false,
      reason: "Known cards cannot be removed by a quantity-only correction.",
    };
  }
  return { ok: true, field: { ...field, groups } };
}

function knownCategoryTotals(
  groups: readonly PermanentGroup[],
  commander: ZoneCommanderIdentity | null,
): Partial<Record<ZoneCategoryKey, number>> {
  const totals: Partial<Record<ZoneCategoryKey, number>> = {};
  for (const group of groups) {
    if (!group.identity) continue;
    for (const key of classifyGroup(group, commander)) {
      totals[key] = safeAdd(totals[key] ?? 0, group.quantity);
    }
  }
  return totals;
}

function clampCollectionMemberships(
  collection: ZoneCompositionCollectionState,
  groups: readonly PermanentGroup[],
): ZoneCompositionCollectionState {
  const next = { ...collection };
  for (const zone of ["graveyard", "exile"] as const) {
    const state = collection[zone];
    const total = physicalTotalForZone(groups, zone);
    const known = knownCategoryTotals(
      groups.filter((group) => group.zone === zone && Boolean(group.identity)),
      collection.commander,
    );
    const manualMemberships = { ...state.manualMemberships };
    for (const [rawKey, rawValue] of Object.entries(manualMemberships)) {
      if (!isZoneCategoryKey(rawKey) || rawValue === undefined) continue;
      const maximum = Math.max(0, total - (known[rawKey] ?? 0));
      const value = Math.min(rawValue, maximum);
      if (value === 0) delete manualMemberships[rawKey];
      else manualMemberships[rawKey] = value;
    }
    next[zone] = { ...state, manualMemberships };
  }
  return next;
}

function classifyGroup(
  group: PermanentGroup,
  commander: ZoneCommanderIdentity | null,
): ZoneCategoryKey[] {
  const keys = new Set<ZoneCategoryKey>();
  const types = new Set(group.characteristics.cardTypes);
  const supertypes = new Set(group.characteristics.supertypes);
  for (const type of types) {
    const normalized =
      type.toLowerCase() === "tribal" ? "kindred" : type.toLowerCase();
    if (isZoneCategoryKey(normalized)) keys.add(normalized);
  }
  if (supertypes.has("Legendary") || group.characteristics.isLegendary) {
    keys.add("legendary");
  }
  keys.add(group.characteristics.isToken ? "token" : "nontoken");
  if (commander?.cardId === group.identity?.cardId) keys.add("commander");
  if (
    keys.has("legendary") ||
    keys.has("artifact") ||
    group.characteristics.subtypes.includes("Saga")
  ) {
    keys.add("historic");
  }
  const colors = normalizeColorCodes(group.characteristics.colors);
  if (colors.length === 0) {
    keys.add("colorless");
  } else {
    for (const color of colors) keys.add(COLOR_NAMES[color]);
    if (colors.length > 1) keys.add("multicolor");
  }
  for (const subtype of group.characteristics.subtypes) {
    const key = zoneSubtypeCategory(subtype);
    if (key) keys.add(key);
  }
  return uniqueSortedCategoryKeys([...keys]);
}

function classifyDeckSnapshotCard(
  card: ZoneDeckSnapshotCard,
  commander: ZoneCommanderIdentity | null,
): ZoneCategoryKey[] {
  const identity = cardIdentityFromDeckSnapshot(card);
  const group = createCardGroup(
    identity,
    Math.max(1, card.quantity ?? 1),
    "graveyard",
  );
  return classifyGroup(
    group,
    card.isCommander
      ? commanderIdentityFromDeckCard(card, isoNow())
      : commander,
  );
}

function cardIdentityFromDeckSnapshot(
  card: ZoneDeckSnapshotCard,
): CardIdentity {
  const typeLine = card.typeLine ?? "";
  const colors = normalizeColorCodes(card.colors ?? []);
  const colorIdentity = normalizeColorCodes(card.colorIdentity ?? colors);
  return {
    cardId: card.cardId,
    name: card.name,
    manaCost: "",
    manaValue: clampInteger(card.manaValue, 0, MAX_ZONE_VALUE, 0),
    typeLine,
    oracleText: card.oracleText ?? "",
    imageUrl: "",
    imageSmall: "",
    imageArt: "",
    colors,
    colorIdentity,
    keywords: [],
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    isToken: Boolean(card.isToken),
    cardFaces: [],
    supportStatus: "quantity-tracking-only",
  };
}

function materializedCategoryKeys(input: {
  knownTotals: Partial<Record<ZoneCategoryKey, number>>;
  state: ZoneCompositionState;
  deckSnapshot?: readonly ZoneDeckSnapshotCard[];
  requestedCategoryKeys?: readonly ZoneCategoryKey[];
}): ZoneCategoryKey[] {
  const deckKeys = (input.deckSnapshot ?? []).flatMap((card) =>
    classifyDeckSnapshotCard(card, null),
  );
  return uniqueSortedCategoryKeys([
    ...DEFAULT_ZONE_CATEGORY_KEYS,
    ...Object.keys(input.knownTotals),
    ...Object.keys(input.state.manualMemberships),
    ...input.state.exactCategoryKeys,
    ...input.state.trackedCategoryKeys,
    ...Object.keys(input.state.authorityCategoryTotals),
    ...(input.requestedCategoryKeys ?? []),
    ...deckKeys,
  ]);
}

function compositionCorrectionSummary(
  zone: CategoricalZone,
  before: ZoneCompositionSnapshot,
  after: ZoneCompositionSnapshot,
  changedCategoryKeys: readonly ZoneCategoryKey[],
): string[] {
  const summary: string[] = [];
  if (before.physicalTotal !== after.physicalTotal) {
    summary.push(
      `${zoneCategoryLabel(zone)} total corrected from ${before.physicalTotal} to ${after.physicalTotal}.`,
    );
  }
  const beforeValues = before.categoryTotals;
  for (const key of uniqueSortedCategoryKeys(changedCategoryKeys)) {
    const previous = beforeValues[key] ?? 0;
    const next = after.categoryTotals[key] ?? 0;
    if (previous !== next) {
      summary.push(
        `${zoneCategoryLabel(key)} cards corrected from ${previous} to ${next}.`,
      );
    }
  }
  if (summary.length === 0)
    summary.push(`${zoneCategoryLabel(zone)} composition confirmed.`);
  return summary;
}

function zoneCategoryKind(key: ZoneCategoryKey): ZoneCategorySnapshot["kind"] {
  if (key.startsWith("subtype:")) return "subtype";
  if ((ZONE_CARD_TYPE_CATEGORIES as readonly string[]).includes(key)) {
    return "card-type";
  }
  if ((ZONE_COLOR_CATEGORIES as readonly string[]).includes(key)) {
    return "color";
  }
  return "characteristic";
}

function inferCommanderFromGroups(
  collection: ZoneCompositionCollectionState,
  groups: readonly PermanentGroup[],
  timestamp: string,
): ZoneCompositionCollectionState {
  const commander = inferredCommanderFromGroups(groups, timestamp);
  if (!commander || commander.cardId === collection.commander?.cardId) {
    return collection;
  }
  return { ...collection, commander };
}

function inferredCommanderFromGroups(
  groups: readonly PermanentGroup[],
  timestamp: string,
): ZoneCommanderIdentity | null {
  const explicit = groups.find(
    (group) =>
      Boolean(group.identity) &&
      (group.zone === "command" ||
        group.label.toLowerCase().includes("commander") ||
        group.notes.toLowerCase().includes("commander")),
  );
  if (!explicit?.identity) return null;
  return {
    cardId: explicit.identity.cardId,
    name: explicit.identity.name,
    colorIdentity: normalizeColorCodes(explicit.identity.colorIdentity),
    source: "canonical-card",
    updatedAt: timestamp,
  };
}

function commanderFromDeckSnapshot(
  deckSnapshot: readonly ZoneDeckSnapshotCard[],
): ZoneCommanderIdentity | null {
  const commander = deckSnapshot.find((card) => card.isCommander);
  return commander ? commanderIdentityFromDeckCard(commander, isoNow()) : null;
}

function commanderIdentityFromDeckCard(
  card: ZoneDeckSnapshotCard,
  timestamp: string,
): ZoneCommanderIdentity {
  return {
    cardId: card.cardId,
    name: card.name,
    colorIdentity: normalizeColorCodes(card.colorIdentity ?? card.colors ?? []),
    source: "deck-snapshot",
    updatedAt: timestamp,
  };
}

function normalizeCommander(
  value: unknown,
  timestamp: string,
): ZoneCommanderIdentity | null {
  const candidate = objectRecord(value);
  if (
    !candidate ||
    typeof candidate.cardId !== "string" ||
    typeof candidate.name !== "string"
  ) {
    return null;
  }
  return {
    cardId: candidate.cardId.slice(0, 160),
    name: candidate.name.slice(0, 160),
    colorIdentity: normalizeColorCodes(candidate.colorIdentity),
    source:
      candidate.source === "deck-snapshot" || candidate.source === "imported"
        ? candidate.source
        : "canonical-card",
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : timestamp,
  };
}

function sanitizeAuthorityTotals(
  value: unknown,
  timestamp: string,
): ZoneCompositionState["authorityCategoryTotals"] {
  const result: ZoneCompositionState["authorityCategoryTotals"] = {};
  const record = objectRecord(value);
  for (const [key, raw] of Object.entries(record ?? {})) {
    if (!isZoneCategoryKey(key)) continue;
    const candidate = objectRecord(raw);
    const safe = safeZoneValue(candidate?.value);
    if (safe === null) continue;
    result[key] = {
      value: safe,
      reference:
        typeof candidate?.reference === "string"
          ? candidate.reference.slice(0, 240)
          : "imported-authority",
      updatedAt:
        typeof candidate?.updatedAt === "string"
          ? candidate.updatedAt
          : timestamp,
    };
  }
  return result;
}

function sanitizeCategoryNumberRecord(
  value: unknown,
): Partial<Record<ZoneCategoryKey, number>> {
  const result: Partial<Record<ZoneCategoryKey, number>> = {};
  const record = objectRecord(value);
  for (const [key, raw] of Object.entries(record ?? {})) {
    if (!isZoneCategoryKey(key)) continue;
    const safe = safeZoneValue(raw);
    if (safe !== null && safe > 0) result[key] = safe;
  }
  return result;
}

function sanitizeCategoryKeys(value: unknown): ZoneCategoryKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isZoneCategoryKey);
}

function physicalTotalForZone(
  groups: readonly PermanentGroup[],
  zone: CategoricalZone,
): number {
  return groups
    .filter((group) => group.zone === zone)
    .reduce((sum, group) => safeAdd(sum, group.quantity), 0);
}

function knownPhysicalCardsForZone(
  groups: readonly PermanentGroup[],
  zone: CategoricalZone,
): number {
  return groups
    .filter((group) => group.zone === zone && Boolean(group.identity))
    .reduce((sum, group) => safeAdd(sum, group.quantity), 0);
}

function normalizeColorCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((entry) => String(entry).trim().toUpperCase())
    .map((entry) => {
      if (entry in COLOR_NAMES) return entry;
      const colorName = entry.toLowerCase() as (typeof COLORS)[number];
      return COLOR_CODES[colorName] ?? "";
    })
    .filter((entry) => entry in COLOR_NAMES);
  return [...new Set(normalized)].sort();
}

function safeZoneValue(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (
    !Number.isFinite(numeric) ||
    !Number.isSafeInteger(Math.trunc(numeric)) ||
    numeric < 0 ||
    numeric > MAX_ZONE_VALUE
  ) {
    return null;
  }
  return Math.trunc(numeric);
}

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const safe = safeZoneValue(value);
  if (safe === null) return fallback;
  return Math.max(minimum, Math.min(maximum, safe));
}

function safeAdd(first: number, second: number): number {
  const value = first + second;
  return Number.isSafeInteger(value) && value <= MAX_ZONE_VALUE
    ? value
    : MAX_ZONE_VALUE;
}

function uniqueSortedCategoryKeys(
  keys: readonly (ZoneCategoryKey | string)[],
): ZoneCategoryKey[] {
  return [...new Set(keys.filter(isZoneCategoryKey))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function failedCommand(
  field: FieldState,
  reason: string,
): ZoneCompositionCommandResult<FieldState> {
  return {
    ok: false,
    field,
    reason,
    summary: [reason],
    changedCategoryKeys: [],
    correctionOnly: true,
    gameplayEventsGenerated: false,
    replacementEffectsApplied: false,
    triggerInstancesGenerated: 0,
    consequenceEventsGenerated: 0,
  };
}

function successfulCommand(
  field: FieldState,
  summary: string[],
  changedCategoryKeys: readonly ZoneCategoryKey[],
): ZoneCompositionCommandResult<FieldState> {
  return {
    ok: true,
    field,
    reason: "Zone composition corrected without creating a gameplay event.",
    summary,
    changedCategoryKeys: uniqueSortedCategoryKeys(changedCategoryKeys),
    correctionOnly: true,
    gameplayEventsGenerated: false,
    replacementEffectsApplied: false,
    triggerInstancesGenerated: 0,
    consequenceEventsGenerated: 0,
  };
}

function isCategoricalZone(value: unknown): value is CategoricalZone {
  return value === "graveyard" || value === "exile";
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function isoNow(): string {
  return new Date(nowMs()).toISOString();
}
