import type { RelevantTotalKey } from "./types";

export const ATHENA_STATIC_DEFINITION_VERSION = 1;

export type AthenaStaticEffectCategory =
  | "continuous-effect"
  | "scaling-effect"
  | "characteristic-defining-effect";

export type AthenaStaticTargetKind =
  | "self"
  | "controlled-creatures"
  | "other-controlled-creatures"
  | "attached-host";

export interface AthenaStaticTargetFilter {
  kind: AthenaStaticTargetKind;
  tokenState: "any" | "token" | "nontoken";
  cardType: string | null;
  subtype: string | null;
  color: string | null;
}

export interface AthenaStaticValueTerm {
  source: "relevant-total" | "attached-equipment-count";
  total: RelevantTotalKey | null;
  multiplier: number;
}

export interface AthenaStaticValueExpression {
  fixed: number;
  terms: AthenaStaticValueTerm[];
}

export interface AthenaStaticEffectDefinition {
  version: typeof ATHENA_STATIC_DEFINITION_VERSION;
  id: string;
  abilityId: string;
  cardNames: string[];
  category: AthenaStaticEffectCategory;
  operation: "add" | "set-base";
  target: AthenaStaticTargetFilter;
  power: AthenaStaticValueExpression;
  toughness: AthenaStaticValueExpression;
  reads: RelevantTotalKey[];
  dependsOnDefinitionIds: string[];
  support: "fully-automated";
}

const noFilter = {
  tokenState: "any" as const,
  cardType: null,
  subtype: null,
  color: null,
};

const fixed = (value: number): AthenaStaticValueExpression => ({
  fixed: value,
  terms: [],
});

const total = (
  key: RelevantTotalKey,
  multiplier = 1,
): AthenaStaticValueExpression => ({
  fixed: 0,
  terms: [{ source: "relevant-total", total: key, multiplier }],
});

const totals = (keys: RelevantTotalKey[]): AthenaStaticValueExpression => ({
  fixed: 0,
  terms: keys.map((key) => ({
    source: "relevant-total" as const,
    total: key,
    multiplier: 1,
  })),
});

const attachedEquipment = (
  multiplier: number,
): AthenaStaticValueExpression => ({
  fixed: 0,
  terms: [
    {
      source: "attached-equipment-count",
      total: "equipment",
      multiplier,
    },
  ],
});

function definition(
  input: Omit<
    AthenaStaticEffectDefinition,
    "version" | "dependsOnDefinitionIds" | "support"
  > & { dependsOnDefinitionIds?: string[] },
): AthenaStaticEffectDefinition {
  return {
    version: ATHENA_STATIC_DEFINITION_VERSION,
    dependsOnDefinitionIds: input.dependsOnDefinitionIds ?? [],
    support: "fully-automated",
    ...input,
    cardNames: input.cardNames.map(normalizeStaticCardName),
  };
}

const controlledCreatures = (input: {
  id: string;
  abilityId: string;
  cardNames: string[];
  amount: number;
  tokenState?: AthenaStaticTargetFilter["tokenState"];
  cardType?: string;
  subtype?: string;
  color?: string;
  other?: boolean;
  reads?: RelevantTotalKey[];
}): AthenaStaticEffectDefinition =>
  definition({
    id: input.id,
    abilityId: input.abilityId,
    cardNames: input.cardNames,
    category: "continuous-effect",
    operation: "add",
    target: {
      kind: input.other ? "other-controlled-creatures" : "controlled-creatures",
      tokenState: input.tokenState ?? "any",
      cardType: input.cardType ?? null,
      subtype: input.subtype ?? null,
      color: input.color ?? null,
    },
    power: fixed(input.amount),
    toughness: fixed(input.amount),
    reads: input.reads ?? [],
  });

const selfCharacteristic = (input: {
  id: string;
  abilityId: string;
  cardNames: string[];
  total: RelevantTotalKey;
}): AthenaStaticEffectDefinition =>
  definition({
    ...input,
    category: "characteristic-defining-effect",
    operation: "set-base",
    target: { kind: "self", ...noFilter },
    power: total(input.total),
    toughness: total(input.total),
    reads: [input.total],
  });

const attachedModifier = (input: {
  id: string;
  abilityId: string;
  cardNames: string[];
  category?: AthenaStaticEffectCategory;
  power: AthenaStaticValueExpression;
  toughness: AthenaStaticValueExpression;
  reads: RelevantTotalKey[];
}): AthenaStaticEffectDefinition =>
  definition({
    ...input,
    category: input.category ?? "continuous-effect",
    operation: "add",
    target: { kind: "attached-host", ...noFilter },
  });

export const ATHENA_STATIC_EFFECT_DEFINITIONS: readonly AthenaStaticEffectDefinition[] =
  [
    controlledCreatures({
      id: "glorious-anthem-creatures",
      abilityId: "controlled-creatures-plus-one",
      cardNames: ["Glorious Anthem", "Gaea's Anthem", "Benalish Marshal"],
      amount: 1,
    }),
    controlledCreatures({
      id: "intangible-virtue-token-creatures",
      abilityId: "token-creatures-plus-one",
      cardNames: ["Intangible Virtue"],
      amount: 1,
      tokenState: "token",
      reads: ["tokens"],
    }),
    controlledCreatures({
      id: "always-watching-nontoken-creatures",
      abilityId: "nontoken-creatures-plus-one",
      cardNames: ["Always Watching"],
      amount: 1,
      tokenState: "nontoken",
      reads: ["nontokenPermanents"],
    }),
    controlledCreatures({
      id: "tempered-steel-artifact-creatures",
      abilityId: "artifact-creatures-plus-two",
      cardNames: ["Tempered Steel"],
      amount: 2,
      cardType: "Artifact",
      reads: ["artifacts"],
    }),
    controlledCreatures({
      id: "honor-of-the-pure-white-creatures",
      abilityId: "white-creatures-plus-one",
      cardNames: ["Honor of the Pure"],
      amount: 1,
      color: "W",
    }),
    controlledCreatures({
      id: "goblin-chieftain-other-goblins",
      abilityId: "other-goblins-plus-one",
      cardNames: ["Goblin Chieftain"],
      amount: 1,
      subtype: "Goblin",
      other: true,
    }),
    controlledCreatures({
      id: "elvish-archdruid-other-elves",
      abilityId: "other-elves-plus-one",
      cardNames: ["Elvish Archdruid"],
      amount: 1,
      subtype: "Elf",
      other: true,
    }),
    selfCharacteristic({
      id: "darksteel-juggernaut-artifact-cda",
      abilityId: "power-toughness-equal-artifacts",
      cardNames: ["Darksteel Juggernaut", "Broodstar"],
      total: "artifacts",
    }),
    selfCharacteristic({
      id: "maro-hand-cda",
      abilityId: "power-toughness-equal-hand",
      cardNames: ["Maro"],
      total: "cardsInHand",
    }),
    selfCharacteristic({
      id: "boneyard-wurm-graveyard-creature-cda",
      abilityId: "power-toughness-equal-graveyard-creatures",
      cardNames: ["Boneyard Wurm"],
      total: "graveyard.creature",
    }),
    selfCharacteristic({
      id: "dauntless-dourbark-forest-cda",
      abilityId: "power-toughness-equal-forests",
      cardNames: ["Dauntless Dourbark"],
      total: "forests",
    }),
    selfCharacteristic({
      id: "primalcrux-green-devotion-cda",
      abilityId: "power-toughness-equal-green-devotion",
      cardNames: ["Primalcrux"],
      total: "devotionGreen",
    }),
    selfCharacteristic({
      id: "master-of-etherium-artifact-cda",
      abilityId: "power-toughness-equal-artifacts",
      cardNames: ["Master of Etherium"],
      total: "artifacts",
    }),
    controlledCreatures({
      id: "master-of-etherium-other-artifacts",
      abilityId: "other-artifact-creatures-plus-one",
      cardNames: ["Master of Etherium"],
      amount: 1,
      cardType: "Artifact",
      other: true,
      reads: ["artifacts"],
    }),
    attachedModifier({
      id: "bonesplitter-equipped-creature",
      abilityId: "equipped-creature-plus-two-power",
      cardNames: ["Bonesplitter"],
      power: fixed(2),
      toughness: fixed(0),
      reads: ["equipment"],
    }),
    attachedModifier({
      id: "sword-of-the-animist-equipped-creature",
      abilityId: "equipped-creature-plus-one",
      cardNames: ["Sword of the Animist"],
      power: fixed(1),
      toughness: fixed(1),
      reads: ["equipment"],
    }),
    attachedModifier({
      id: "blackblade-reforged-land-scaling",
      abilityId: "equipped-creature-plus-lands",
      cardNames: ["Blackblade Reforged"],
      category: "scaling-effect",
      power: total("lands"),
      toughness: total("lands"),
      reads: ["lands"],
    }),
    attachedModifier({
      id: "cranial-plating-artifact-scaling",
      abilityId: "equipped-creature-plus-artifacts",
      cardNames: ["Cranial Plating"],
      category: "scaling-effect",
      power: total("artifacts"),
      toughness: fixed(0),
      reads: ["artifacts"],
    }),
    attachedModifier({
      id: "nettlecyst-artifact-enchantment-scaling",
      abilityId: "equipped-creature-plus-artifacts-enchantments",
      cardNames: ["Nettlecyst", "All That Glitters"],
      category: "scaling-effect",
      power: totals(["artifacts", "enchantments"]),
      toughness: totals(["artifacts", "enchantments"]),
      reads: ["artifacts", "enchantments"],
    }),
    attachedModifier({
      id: "ethereal-armor-enchantment-scaling",
      abilityId: "enchanted-creature-plus-enchantments",
      cardNames: ["Ethereal Armor"],
      category: "scaling-effect",
      power: total("enchantments"),
      toughness: total("enchantments"),
      reads: ["enchantments"],
    }),
    definition({
      id: "goblin-gaveleer-equipment-scaling",
      abilityId: "self-plus-attached-equipment",
      cardNames: ["Goblin Gaveleer"],
      category: "scaling-effect",
      operation: "add",
      target: { kind: "self", ...noFilter },
      power: attachedEquipment(2),
      toughness: fixed(0),
      reads: ["equipment"],
    }),
  ];

export function normalizeStaticCardName(name: string): string {
  return name.trim().toLowerCase();
}

export function getAthenaStaticEffectDefinitionsForCard(
  name: string | null | undefined,
  definitions: readonly AthenaStaticEffectDefinition[] = ATHENA_STATIC_EFFECT_DEFINITIONS,
): AthenaStaticEffectDefinition[] {
  if (!name) return [];
  const normalized = normalizeStaticCardName(name);
  return definitions
    .filter((entry) => entry.cardNames.includes(normalized))
    .map(cloneDefinition)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function hasAthenaStaticEffectDefinition(name: string): boolean {
  return getAthenaStaticEffectDefinitionsForCard(name).length > 0;
}

function cloneDefinition(
  value: AthenaStaticEffectDefinition,
): AthenaStaticEffectDefinition {
  return {
    ...value,
    cardNames: [...value.cardNames],
    target: { ...value.target },
    power: {
      ...value.power,
      terms: value.power.terms.map((term) => ({ ...term })),
    },
    toughness: {
      ...value.toughness,
      terms: value.toughness.terms.map((term) => ({ ...term })),
    },
    reads: [...value.reads],
    dependsOnDefinitionIds: [...value.dependsOnDefinitionIds],
  };
}
