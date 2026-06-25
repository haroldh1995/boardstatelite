import type {
  CardIdentity,
  Characteristics,
  CounterName,
  PermanentGroup,
  PowerToughnessState,
  StatusFlags,
  SupportStatus,
  Zone,
} from "./types";

const CARD_TYPES = [
  "Artifact",
  "Battle",
  "Creature",
  "Enchantment",
  "Instant",
  "Kindred",
  "Land",
  "Planeswalker",
  "Sorcery",
];

const SUPERTYPES = ["Basic", "Legendary", "Snow", "World", "Ongoing"];

export const COUNTER_OPTIONS: CounterName[] = [
  "+1/+1",
  "-1/-1",
  "Shield",
  "Stun",
  "Finality",
  "Flying",
  "First strike",
  "Double strike",
  "Deathtouch",
  "Haste",
  "Hexproof",
  "Indestructible",
  "Lifelink",
  "Menace",
  "Reach",
  "Trample",
  "Vigilance",
  "Charge",
  "Oil",
  "Time",
  "Lore",
  "Loyalty",
  "Defense",
  "Level",
  "Quest",
  "Age",
  "Brick",
  "Verse",
];

export function emptyStatuses(): StatusFlags {
  return {
    tapped: false,
    attacking: false,
    blocking: false,
    summoningSick: false,
    phasedOut: false,
    transformed: false,
    faceDown: false,
    exerted: false,
    modified: false,
    damaged: false,
    depowered: false,
  };
}

export function makeId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export function parseCharacteristics(
  typeLine: string,
  identity?: Pick<CardIdentity, "colors" | "manaValue" | "isToken">,
): Characteristics {
  const normalized = typeLine.replace(/[—–]/g, "-");
  const [left, right = ""] = normalized.split("-").map((part) => part.trim());
  const leftParts = left.split(/\s+/).filter(Boolean);
  const supertypes = leftParts.filter((part) => SUPERTYPES.includes(part));
  const cardTypes = leftParts.filter((part) => CARD_TYPES.includes(part));
  const subtypes = right.split(/\s+/).filter(Boolean);
  const isToken =
    Boolean(identity?.isToken) ||
    normalized.toLowerCase().includes("token") ||
    subtypes.includes("Token");

  return {
    supertypes,
    cardTypes,
    subtypes,
    colors: identity?.colors ?? [],
    manaValue: identity?.manaValue ?? 0,
    isToken,
    isCreature: cardTypes.includes("Creature"),
    isLegendary: supertypes.includes("Legendary"),
  };
}

export function supportStatusForCard(
  name: string,
  oracleText: string,
): SupportStatus {
  const normalizedName = name.toLowerCase();
  const normalizedOracle = oracleText.toLowerCase();
  if (
    normalizedName.includes("anim pakal") ||
    normalizedName.includes("cathars' crusade") ||
    normalizedName.includes("doubling season") ||
    normalizedName.includes("soul warden") ||
    normalizedName.includes("essence warden") ||
    normalizedName.includes("impact tremors") ||
    normalizedName.includes("rampaging baloths")
  ) {
    return "fully-automated";
  }
  if (
    normalizedOracle.includes("landfall") ||
    normalizedOracle.includes("whenever a land enters")
  ) {
    return "partially-automated";
  }
  if (
    normalizedOracle.includes("whenever") ||
    normalizedOracle.includes("if one or more")
  ) {
    return "partially-automated";
  }
  return "quantity-tracking-only";
}

export function toNumberStat(
  value: string | number | null | undefined,
): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildPowerToughness(
  identity: CardIdentity | null,
  overrides?: Partial<PowerToughnessState>,
): PowerToughnessState {
  const printedPower = toNumberStat(identity?.power);
  const printedToughness = toNumberStat(identity?.toughness);
  return {
    printedPower,
    printedToughness,
    basePower: overrides?.basePower ?? printedPower,
    baseToughness: overrides?.baseToughness ?? printedToughness,
    currentPower: overrides?.currentPower ?? printedPower,
    currentToughness: overrides?.currentToughness ?? printedToughness,
    temporaryPower: overrides?.temporaryPower ?? 0,
    temporaryToughness: overrides?.temporaryToughness ?? 0,
    staticPower: overrides?.staticPower ?? 0,
    staticToughness: overrides?.staticToughness ?? 0,
    powerToughnessSwitch: overrides?.powerToughnessSwitch ?? false,
    damage: overrides?.damage ?? 0,
  };
}

export function recalculateStats(group: PermanentGroup): PermanentGroup {
  const plus = group.counters["+1/+1"] ?? 0;
  const minus = group.counters["-1/-1"] ?? 0;
  const basePower = group.pt.basePower;
  const baseToughness = group.pt.baseToughness;
  const computedPower =
    basePower === null
      ? null
      : basePower +
        plus -
        minus +
        group.pt.staticPower +
        group.pt.temporaryPower;
  const computedToughness =
    baseToughness === null
      ? null
      : baseToughness +
        plus -
        minus +
        group.pt.staticToughness +
        group.pt.temporaryToughness;
  return {
    ...group,
    statuses: {
      ...group.statuses,
      modified:
        plus > 0 ||
        minus > 0 ||
        group.pt.staticPower !== 0 ||
        group.pt.staticToughness !== 0 ||
        group.pt.temporaryPower !== 0 ||
        group.pt.temporaryToughness !== 0,
      damaged: group.pt.damage > 0,
    },
    pt: {
      ...group.pt,
      currentPower: group.pt.powerToughnessSwitch
        ? computedToughness
        : computedPower,
      currentToughness: group.pt.powerToughnessSwitch
        ? computedPower
        : computedToughness,
    },
  };
}

export function createGenericGroup(input: {
  kind:
    | "Creature"
    | "Artifact"
    | "Equipment"
    | "Enchantment"
    | "Land"
    | "Token"
    | "Noncreature permanent"
    | "Custom";
  label?: string;
  quantity?: number;
  power?: number | null;
  toughness?: number | null;
  zone?: Zone;
  cardTypes?: string[];
  subtypes?: string[];
  token?: boolean;
}): PermanentGroup {
  const cardTypes = input.cardTypes ?? defaultGenericTypes(input.kind);
  const subtypes = input.subtypes ?? defaultGenericSubtypes(input.kind);
  const label = input.label || `Generic ${input.kind}`;
  const characteristics: Characteristics = {
    supertypes: [],
    cardTypes,
    subtypes,
    colors: [],
    manaValue: 0,
    isToken: input.token ?? input.kind === "Token",
    isCreature: cardTypes.includes("Creature"),
    isLegendary: false,
  };
  const group: PermanentGroup = {
    id: makeId("group"),
    quantity: Math.max(1, input.quantity ?? 1),
    zone: input.zone ?? "battlefield",
    owner: "you",
    controller: "you",
    label,
    identity: null,
    originalIdentity: null,
    originalCharacteristics: null,
    characteristics,
    counters: {},
    statuses: emptyStatuses(),
    attachments: [],
    attachedTo: null,
    order: Date.now(),
    abilitiesActive: false,
    depowerMode: "none",
    disabledAbilities: [],
    isGeneric: true,
    notes: "",
    stackKey: "",
    pt: buildPowerToughness(null, {
      basePower: input.power ?? (cardTypes.includes("Creature") ? 1 : null),
      baseToughness:
        input.toughness ?? (cardTypes.includes("Creature") ? 1 : null),
      currentPower: input.power ?? (cardTypes.includes("Creature") ? 1 : null),
      currentToughness:
        input.toughness ?? (cardTypes.includes("Creature") ? 1 : null),
    }),
  };
  return withStackKey(recalculateStats(group));
}

export function createCardGroup(
  card: CardIdentity,
  quantity = 1,
  zone: Zone = "battlefield",
): PermanentGroup {
  const characteristics = parseCharacteristics(card.typeLine, card);
  const group: PermanentGroup = {
    id: makeId("group"),
    quantity: Math.max(1, quantity),
    zone,
    owner: "you",
    controller: "you",
    label: card.name,
    identity: card,
    originalIdentity: card,
    originalCharacteristics: characteristics,
    characteristics,
    counters: {},
    statuses: emptyStatuses(),
    attachments: [],
    attachedTo: null,
    order: Date.now(),
    abilitiesActive: true,
    depowerMode: "none",
    disabledAbilities: [],
    isGeneric: false,
    notes: "",
    stackKey: "",
    pt: buildPowerToughness(card),
  };
  return withStackKey(recalculateStats(group));
}

export function createTokenGroup(input: {
  name: string;
  quantity: number;
  power: number;
  toughness: number;
  subtypes: string[];
  colors?: string[];
  tapped?: boolean;
  attacking?: boolean;
  imageUrl?: string;
  oracleText?: string;
}): PermanentGroup {
  const identity: CardIdentity = {
    cardId: `token:${input.name.toLowerCase()}:${input.power}/${input.toughness}:${input.subtypes.join(".")}`,
    name: input.name,
    manaCost: "",
    manaValue: 0,
    typeLine: `Token Creature - ${input.subtypes.join(" ")}`.trim(),
    oracleText: input.oracleText ?? "",
    imageUrl: input.imageUrl ?? "",
    imageSmall: input.imageUrl ?? "",
    imageArt: "",
    colors: input.colors ?? [],
    colorIdentity: input.colors ?? [],
    keywords: [],
    power: String(input.power),
    toughness: String(input.toughness),
    loyalty: null,
    defense: null,
    isToken: true,
    cardFaces: [],
    supportStatus: "quantity-tracking-only",
  };
  const group = createCardGroup(identity, input.quantity);
  return withStackKey(
    recalculateStats({
      ...group,
      statuses: {
        ...group.statuses,
        tapped: Boolean(input.tapped),
        attacking: Boolean(input.attacking),
      },
      characteristics: {
        ...group.characteristics,
        isToken: true,
      },
    }),
  );
}

export function withStackKey(group: PermanentGroup): PermanentGroup {
  const stackIdentity = group.identity?.cardId ?? `generic:${group.label}`;
  const keyPayload = {
    stackIdentity,
    zone: group.zone,
    owner: group.owner,
    controller: group.controller,
    characteristics: group.characteristics,
    counters: group.counters,
    statuses: group.statuses,
    pt: {
      basePower: group.pt.basePower,
      baseToughness: group.pt.baseToughness,
      temporaryPower: group.pt.temporaryPower,
      temporaryToughness: group.pt.temporaryToughness,
      staticPower: group.pt.staticPower,
      staticToughness: group.pt.staticToughness,
      damage: group.pt.damage,
      switch: group.pt.powerToughnessSwitch,
    },
    attachedTo: group.attachedTo,
    attachments: group.attachments,
    abilitiesActive: group.abilitiesActive,
    depowerMode: group.depowerMode,
    isGeneric: group.isGeneric,
    transformed: group.statuses.transformed,
  };
  return { ...group, stackKey: stableStringify(keyPayload) };
}

export function mergeCompatibleStacks(
  groups: PermanentGroup[],
): PermanentGroup[] {
  const merged = new Map<string, PermanentGroup>();
  for (const group of groups.map((entry) =>
    withStackKey(recalculateStats(entry)),
  )) {
    const existing = merged.get(group.stackKey);
    if (!existing) {
      merged.set(group.stackKey, group);
      continue;
    }
    merged.set(group.stackKey, {
      ...existing,
      quantity: existing.quantity + group.quantity,
      order: Math.min(existing.order, group.order),
    });
  }
  return [...merged.values()].sort((a, b) => a.order - b.order);
}

export function splitGroupForQuantity(
  groups: PermanentGroup[],
  groupId: string,
  quantity: number,
): {
  groups: PermanentGroup[];
  targetId: string | null;
} {
  const group = groups.find((entry) => entry.id === groupId);
  if (!group) {
    return { groups, targetId: null };
  }
  const targetQuantity = Math.max(1, Math.min(quantity, group.quantity));
  if (targetQuantity === group.quantity) {
    return { groups, targetId: group.id };
  }
  const splitId = makeId("group");
  const nextGroups = groups.map((entry) =>
    entry.id === groupId
      ? { ...entry, quantity: entry.quantity - targetQuantity }
      : entry,
  );
  nextGroups.push({
    ...group,
    id: splitId,
    quantity: targetQuantity,
    order: group.order + 0.01,
  });
  return { groups: nextGroups, targetId: splitId };
}

function defaultGenericTypes(
  kind: Parameters<typeof createGenericGroup>[0]["kind"],
): string[] {
  switch (kind) {
    case "Creature":
    case "Token":
      return ["Creature"];
    case "Artifact":
      return ["Artifact"];
    case "Equipment":
      return ["Artifact"];
    case "Enchantment":
      return ["Enchantment"];
    case "Land":
      return ["Land"];
    case "Noncreature permanent":
      return ["Artifact"];
    case "Custom":
      return ["Artifact"];
  }
}

function defaultGenericSubtypes(
  kind: Parameters<typeof createGenericGroup>[0]["kind"],
): string[] {
  switch (kind) {
    case "Equipment":
      return ["Equipment"];
    case "Land":
      return ["Land"];
    case "Token":
      return ["Token"];
    default:
      return [];
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${key}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
