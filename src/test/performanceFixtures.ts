import {
  createCardGroup,
  createGenericGroup,
  recalculateStats,
  withStackKey,
} from "../domain/cards";
import { createDefaultField, normalizeField } from "../domain/field";
import type { CardIdentity, FieldState, PermanentGroup } from "../domain/types";
import { addPlannedAction } from "../echo/preTurnPlanner";

const FIXTURE_TIMESTAMP = "2026-08-21T12:00:00.000Z";

export function createNormalMidgamePerformanceFixture(): FieldState {
  return createPerformanceFixture({
    battlefieldGroupCount: 29,
    tokenStackCount: 4,
    tokenQuantity: 12,
    graveyardCount: 12,
    exileCount: 5,
    plannedActionCount: 4,
  });
}

export function createHeavyLateGamePerformanceFixture(): FieldState {
  return createPerformanceFixture({
    battlefieldGroupCount: 110,
    tokenStackCount: 20,
    tokenQuantity: 64,
    graveyardCount: 55,
    exileCount: 24,
    plannedActionCount: 10,
  });
}

function createPerformanceFixture(input: {
  battlefieldGroupCount: number;
  tokenStackCount: number;
  tokenQuantity: number;
  graveyardCount: number;
  exileCount: number;
  plannedActionCount: number;
}): FieldState {
  const battlefield: PermanentGroup[] = [];
  const landCount = Math.min(20, Math.floor(input.battlefieldGroupCount / 5));
  const creatureCount = Math.max(
    8,
    Math.floor(input.battlefieldGroupCount / 3),
  );
  const attachmentCount = Math.min(
    8,
    Math.floor(input.battlefieldGroupCount / 12),
  );

  for (let index = 0; index < landCount; index += 1) {
    battlefield.push(
      fixtureGroup(index, "Land", `Land ${index + 1}`, {
        cardTypes: ["Land"],
        subtypes: index < 5 ? ["Forest"] : [],
      }),
    );
  }
  for (let index = 0; index < creatureCount; index += 1) {
    battlefield.push(
      fixtureGroup(100 + index, "Creature", `Creature ${index + 1}`, {
        power: 2 + (index % 5),
        toughness: 2 + (index % 6),
        counters: index % 3 === 0 ? { "+1/+1": index + 1 } : {},
        subtypes: [index % 2 === 0 ? "Soldier" : "Elf"],
      }),
    );
  }
  for (let index = 0; index < input.tokenStackCount; index += 1) {
    battlefield.push(
      fixtureGroup(300 + index, "Token", `Token Stack ${index + 1}`, {
        quantity: input.tokenQuantity + index,
        power: 1,
        toughness: 1,
        token: true,
        cardTypes: ["Artifact", "Creature"],
        subtypes: index % 2 === 0 ? ["Soldier"] : ["Servo"],
      }),
    );
  }
  while (battlefield.length < input.battlefieldGroupCount - attachmentCount) {
    const index = battlefield.length;
    battlefield.push(
      fixtureGroup(500 + index, "Artifact", `Artifact ${index + 1}`, {
        cardTypes: ["Artifact"],
      }),
    );
  }
  for (let index = 0; index < attachmentCount; index += 1) {
    const host = battlefield[landCount + (index % creatureCount)];
    const attachment = fixtureGroup(
      800 + index,
      "Equipment",
      `Equipment ${index + 1}`,
      {
        cardTypes: ["Artifact"],
        subtypes: ["Equipment"],
        attachedTo: host.id,
      },
    );
    host.attachments = [...host.attachments, attachment.id];
    battlefield.push(attachment);
  }
  injectRuleAwarePermanents(battlefield);

  const graveyard = Array.from({ length: input.graveyardCount }, (_, index) =>
    fixtureGroup(1_000 + index, "Custom", `Graveyard Card ${index + 1}`, {
      zone: "graveyard",
      cardTypes: [index % 3 === 0 ? "Creature" : "Sorcery"],
      subtypes: index % 6 === 0 ? ["Elf"] : [],
    }),
  );
  const exile = Array.from({ length: input.exileCount }, (_, index) =>
    fixtureGroup(2_000 + index, "Custom", `Exile Card ${index + 1}`, {
      zone: "exile",
      cardTypes: [index % 2 === 0 ? "Artifact" : "Instant"],
    }),
  );

  let field = createDefaultField();
  let planner = field.preTurnPlanner;
  for (let index = 0; index < input.plannedActionCount; index += 1) {
    planner = addPlannedAction(
      planner,
      index === 0
        ? {
            id: "performance-land-action",
            type: "land-play",
            title: "Forest",
            land: { primary: "Forest" },
          }
        : {
            id: `performance-action-${index}`,
            type: index % 3 === 0 ? "planned-attack" : "note",
            title: `Prepared Action ${index}`,
            relatedGroupId:
              index % 3 === 0
                ? battlefield[landCount + (index % creatureCount)].id
                : null,
          },
      FIXTURE_TIMESTAMP,
    );
  }
  field = normalizeField({
    ...field,
    id: `performance-field-${input.battlefieldGroupCount}`,
    name: `Athena Performance ${input.battlefieldGroupCount}`,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    groups: [...battlefield, ...graveyard, ...exile],
    preTurnPlanner: planner,
    ambient: {
      ...field.ambient,
      currentMode: "activeTurn",
      context: {
        ...field.ambient.context,
        sessionId: field.session.id,
      },
    },
  });
  return field;
}

function injectRuleAwarePermanents(groups: PermanentGroup[]): void {
  const candidates = groups
    .map((group, index) => ({ group, index }))
    .filter(
      ({ group }) =>
        !group.characteristics.isToken &&
        !group.characteristics.cardTypes.includes("Land") &&
        !group.attachedTo &&
        group.attachments.length === 0,
    );
  PERFORMANCE_RULE_CARDS.forEach((card, index) => {
    const candidate = candidates[index];
    if (!candidate) return;
    const replacement = createCardGroup(card);
    groups[candidate.index] = withStackKey(
      recalculateStats({
        ...replacement,
        id: candidate.group.id,
        order: candidate.group.order,
      }),
    );
  });
}

const PERFORMANCE_RULE_CARDS: readonly CardIdentity[] = [
  performanceCard(
    "Glorious Anthem",
    "Enchantment",
    "Creatures you control get +1/+1.",
  ),
  performanceCard(
    "Intangible Virtue",
    "Enchantment",
    "Creature tokens you control get +1/+1 and have vigilance.",
  ),
  performanceCard(
    "Always Watching",
    "Enchantment",
    "Nontoken creatures you control get +1/+1 and have vigilance.",
  ),
  performanceCard(
    "Tempered Steel",
    "Enchantment",
    "Artifact creatures you control get +2/+2.",
  ),
  performanceCard(
    "Elvish Archdruid",
    "Creature - Elf Druid",
    "Other Elf creatures you control get +1/+1.",
    "2",
    "2",
  ),
  performanceCard(
    "Darksteel Juggernaut",
    "Artifact Creature - Juggernaut",
    "Darksteel Juggernaut's power and toughness are each equal to the number of artifacts you control.",
    "*",
    "*",
  ),
  performanceCard(
    "Maro",
    "Creature - Elemental",
    "Maro's power and toughness are each equal to the number of cards in your hand.",
    "*",
    "*",
  ),
  performanceCard(
    "Boneyard Wurm",
    "Creature - Wurm",
    "Boneyard Wurm's power and toughness are each equal to the number of creature cards in your graveyard.",
    "*",
    "*",
  ),
  performanceCard(
    "Honor of the Pure",
    "Enchantment",
    "White creatures you control get +1/+1.",
  ),
  performanceCard(
    "Master of Etherium",
    "Artifact Creature - Vedalken Wizard",
    "Master of Etherium's power and toughness are each equal to the number of artifacts you control. Other artifact creatures you control get +1/+1.",
    "*",
    "*",
  ),
  performanceCard(
    "Doubling Season",
    "Enchantment",
    "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead. If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.",
  ),
  performanceCard(
    "Anointed Procession",
    "Enchantment",
    "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.",
  ),
  performanceCard(
    "Cathars' Crusade",
    "Enchantment",
    "Whenever a creature enters the battlefield under your control, put a +1/+1 counter on each creature you control.",
  ),
  performanceCard(
    "Soul Warden",
    "Creature - Human Cleric",
    "Whenever another creature enters the battlefield, you gain 1 life.",
    "1",
    "1",
  ),
  performanceCard(
    "Rampaging Baloths",
    "Creature - Beast",
    "Landfall - Whenever a land enters the battlefield under your control, create a 4/4 green Beast creature token.",
    "6",
    "6",
  ),
];

function performanceCard(
  name: string,
  typeLine: string,
  oracleText: string,
  power: string | null = null,
  toughness: string | null = null,
): CardIdentity {
  return {
    cardId: `performance-card-${name.toLowerCase().replace(/\W+/g, "-")}`,
    name,
    manaCost: "",
    manaValue: 0,
    typeLine,
    oracleText,
    imageUrl: "",
    imageSmall: "",
    imageArt: "",
    colors: [],
    colorIdentity: [],
    keywords: [],
    power,
    toughness,
    loyalty: null,
    defense: null,
    isToken: false,
    cardFaces: [],
    supportStatus: "fully-automated",
  };
}

function fixtureGroup(
  order: number,
  kind: Parameters<typeof createGenericGroup>[0]["kind"],
  label: string,
  input: Partial<Parameters<typeof createGenericGroup>[0]> & {
    counters?: Record<string, number>;
    attachedTo?: string | null;
  } = {},
): PermanentGroup {
  const group = createGenericGroup({
    kind,
    label,
    quantity: input.quantity,
    power: input.power,
    toughness: input.toughness,
    zone: input.zone,
    cardTypes: input.cardTypes,
    subtypes: input.subtypes,
    token: input.token,
  });
  return withStackKey(
    recalculateStats({
      ...group,
      id: `performance-group-${order}`,
      order,
      counters: input.counters ?? {},
      attachedTo: input.attachedTo ?? null,
    }),
  );
}
