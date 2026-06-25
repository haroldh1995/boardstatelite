import {
  createCardGroup,
  createGenericGroup,
  recalculateStats,
  withStackKey,
} from "../domain/cards";
import {
  createDefaultField,
  createDefaultOpponentValues,
  createDefaultPlayer,
  createDefaultSettings,
  createDefaultWatcherPreferences,
  DEFAULT_PINNED_TOTALS,
} from "../domain/field";
import type { CardIdentity, FieldState, PermanentGroup } from "../domain/types";

type FixtureCardInput = Pick<
  CardIdentity,
  | "cardId"
  | "oracleId"
  | "name"
  | "typeLine"
  | "oracleText"
  | "manaCost"
  | "manaValue"
  | "colors"
  | "colorIdentity"
  | "power"
  | "toughness"
  | "imageUrl"
  | "imageSmall"
  | "imageArt"
  | "isToken"
  | "supportStatus"
> & {
  setCode?: string;
  collectorNumber?: string;
};

const CARDS = {
  animPakal: fixtureCard({
    cardId: "868856b7-8875-43c1-8249-0f8fb2c8319b",
    oracleId: "05551d91-50c6-46d1-86a4-cd3d177d0923",
    name: "Anim Pakal, Thousandth Moon",
    manaCost: "{1}{R}{W}",
    manaValue: 3,
    typeLine: "Legendary Creature - Human Soldier",
    oracleText:
      "Whenever you attack with one or more non-Gnome creatures, put a +1/+1 counter on Anim Pakal, then create X 1/1 colorless Gnome artifact creature tokens that are tapped and attacking, where X is the number of +1/+1 counters on Anim Pakal.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/8/6/868856b7-8875-43c1-8249-0f8fb2c8319b.jpg?1699044523",
    imageSmall:
      "https://cards.scryfall.io/small/front/8/6/868856b7-8875-43c1-8249-0f8fb2c8319b.jpg?1699044523",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/8/6/868856b7-8875-43c1-8249-0f8fb2c8319b.jpg?1699044523",
    colors: ["R", "W"],
    colorIdentity: ["R", "W"],
    power: "1",
    toughness: "2",
    isToken: false,
    supportStatus: "fully-automated",
    setCode: "lci",
    collectorNumber: "223",
  }),
  avenger: fixtureCard({
    cardId: "c6f1e60f-a195-4590-80b0-86767de6c423",
    oracleId: "4ba5b3f6-503b-43e6-b66e-4f8c55cffed7",
    name: "Avenger of Zendikar",
    manaCost: "{5}{G}{G}",
    manaValue: 7,
    typeLine: "Creature - Elemental",
    oracleText:
      "When this creature enters, create a 0/1 green Plant creature token for each land you control. Landfall - Whenever a land you control enters, you may put a +1/+1 counter on each Plant creature you control.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/c/6/c6f1e60f-a195-4590-80b0-86767de6c423.jpg?1768144265",
    imageSmall:
      "https://cards.scryfall.io/small/front/c/6/c6f1e60f-a195-4590-80b0-86767de6c423.jpg?1768144265",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/c/6/c6f1e60f-a195-4590-80b0-86767de6c423.jpg?1768144265",
    colors: ["G"],
    colorIdentity: ["G"],
    power: "5",
    toughness: "5",
    isToken: false,
    supportStatus: "partially-automated",
    setCode: "ecc",
    collectorNumber: "98",
  }),
  saproling: fixtureCard({
    cardId: "248ade83-ac57-42d6-985c-1e4cc3639f36",
    oracleId: "saproling-reference-token",
    name: "Saproling",
    manaCost: "",
    manaValue: 0,
    typeLine: "Token Creature - Saproling",
    oracleText: "",
    imageUrl:
      "https://cards.scryfall.io/normal/front/2/4/248ade83-ac57-42d6-985c-1e4cc3639f36.jpg?1775827578",
    imageSmall:
      "https://cards.scryfall.io/small/front/2/4/248ade83-ac57-42d6-985c-1e4cc3639f36.jpg?1775827578",
    imageArt: "",
    colors: ["G"],
    colorIdentity: ["G"],
    power: "1",
    toughness: "1",
    isToken: true,
    supportStatus: "quantity-tracking-only",
  }),
  hydra: fixtureCard({
    cardId: "29515c55-3b48-4c1d-a10b-b27fd1eb7a93",
    oracleId: "1c36ed3a-c806-47e5-83f9-e44999c67fe5",
    name: "Primordial Hydra",
    manaCost: "{X}{G}{G}",
    manaValue: 2,
    typeLine: "Creature - Hydra",
    oracleText:
      "This creature enters with X +1/+1 counters on it. At the beginning of your upkeep, double the number of +1/+1 counters on this creature.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/2/9/29515c55-3b48-4c1d-a10b-b27fd1eb7a93.jpg?1775941583",
    imageSmall:
      "https://cards.scryfall.io/small/front/2/9/29515c55-3b48-4c1d-a10b-b27fd1eb7a93.jpg?1775941583",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/2/9/29515c55-3b48-4c1d-a10b-b27fd1eb7a93.jpg?1775941583",
    colors: ["G"],
    colorIdentity: ["G"],
    power: "0",
    toughness: "0",
    isToken: false,
    supportStatus: "partially-automated",
  }),
  scute: fixtureCard({
    cardId: "ea630ba1-22f9-4a10-bdc6-0d03128214f4",
    oracleId: "aa854d50-444c-49d9-bfb1-5476b33c1c0b",
    name: "Scute Swarm",
    manaCost: "{2}{G}",
    manaValue: 3,
    typeLine: "Creature - Insect",
    oracleText:
      "Landfall - Whenever a land you control enters, create a 1/1 green Insect creature token.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/e/a/ea630ba1-22f9-4a10-bdc6-0d03128214f4.jpg?1726285123",
    imageSmall:
      "https://cards.scryfall.io/small/front/e/a/ea630ba1-22f9-4a10-bdc6-0d03128214f4.jpg?1726285123",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/e/a/ea630ba1-22f9-4a10-bdc6-0d03128214f4.jpg?1726285123",
    colors: ["G"],
    colorIdentity: ["G"],
    power: "1",
    toughness: "1",
    isToken: false,
    supportStatus: "partially-automated",
  }),
  champion: fixtureCard({
    cardId: "46eff31d-f460-48f2-aab7-8b9b89cd87fe",
    oracleId: "c549b0fd-1e08-4873-952e-a14dc45a0fd2",
    name: "Champion of Lambholt",
    manaCost: "{1}{G}{G}",
    manaValue: 3,
    typeLine: "Creature - Human Warrior",
    oracleText:
      "Creatures with power less than this creature's power can't block creatures you control. Whenever another creature you control enters, put a +1/+1 counter on this creature.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/4/6/46eff31d-f460-48f2-aab7-8b9b89cd87fe.jpg?1682209453",
    imageSmall:
      "https://cards.scryfall.io/small/front/4/6/46eff31d-f460-48f2-aab7-8b9b89cd87fe.jpg?1682209453",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/4/6/46eff31d-f460-48f2-aab7-8b9b89cd87fe.jpg?1682209453",
    colors: ["G"],
    colorIdentity: ["G"],
    power: "1",
    toughness: "1",
    isToken: false,
    supportStatus: "partially-automated",
  }),
  cathars: fixtureCard({
    cardId: "5296e353-2efc-4d72-a877-7957eff630b9",
    oracleId: "cc65ac73-5bef-4ecb-ad8e-39199084c027",
    name: "Cathars' Crusade",
    manaCost: "{3}{W}{W}",
    manaValue: 5,
    typeLine: "Enchantment",
    oracleText:
      "Whenever a creature you control enters, put a +1/+1 counter on each creature you control.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/5/2/5296e353-2efc-4d72-a877-7957eff630b9.jpg?1736467489",
    imageSmall:
      "https://cards.scryfall.io/small/front/5/2/5296e353-2efc-4d72-a877-7957eff630b9.jpg?1736467489",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/5/2/5296e353-2efc-4d72-a877-7957eff630b9.jpg?1736467489",
    colors: ["W"],
    colorIdentity: ["W"],
    power: null,
    toughness: null,
    isToken: false,
    supportStatus: "fully-automated",
  }),
  doubling: fixtureCard({
    cardId: "f2c4f80e-84a0-463b-82c3-5c6503809351",
    oracleId: "01546b7d-a233-4176-8843-d732074dc5b6",
    name: "Doubling Season",
    manaCost: "{4}{G}",
    manaValue: 5,
    typeLine: "Enchantment",
    oracleText:
      "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead. If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/f/2/f2c4f80e-84a0-463b-82c3-5c6503809351.jpg?1730489400",
    imageSmall:
      "https://cards.scryfall.io/small/front/f/2/f2c4f80e-84a0-463b-82c3-5c6503809351.jpg?1730489400",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/f/2/f2c4f80e-84a0-463b-82c3-5c6503809351.jpg?1730489400",
    colors: ["G"],
    colorIdentity: ["G"],
    power: null,
    toughness: null,
    isToken: false,
    supportStatus: "fully-automated",
  }),
  solRing: fixtureCard({
    cardId: "91fdb56b-54d5-4272-8319-505ff987fe9b",
    oracleId: "6ad8011d-3471-4369-9d68-b264cc027487",
    name: "Sol Ring",
    manaCost: "{1}",
    manaValue: 1,
    typeLine: "Artifact",
    oracleText: "{T}: Add {C}{C}.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1780930072",
    imageSmall:
      "https://cards.scryfall.io/small/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1780930072",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1780930072",
    colors: [],
    colorIdentity: [],
    power: null,
    toughness: null,
    isToken: false,
    supportStatus: "quantity-tracking-only",
  }),
  ozolith: fixtureCard({
    cardId: "9341ed06-53db-4604-b60a-3ea9129afbc2",
    oracleId: "1946ded1-5f53-409f-b0a6-5433bb0357d2",
    name: "The Ozolith",
    manaCost: "{1}",
    manaValue: 1,
    typeLine: "Legendary Artifact",
    oracleText:
      "Whenever a creature you control leaves the battlefield, if it had counters on it, put those counters on The Ozolith.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/9/3/9341ed06-53db-4604-b60a-3ea9129afbc2.jpg?1591228544",
    imageSmall:
      "https://cards.scryfall.io/small/front/9/3/9341ed06-53db-4604-b60a-3ea9129afbc2.jpg?1591228544",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/9/3/9341ed06-53db-4604-b60a-3ea9129afbc2.jpg?1591228544",
    colors: [],
    colorIdentity: [],
    power: null,
    toughness: null,
    isToken: false,
    supportStatus: "partially-automated",
  }),
  sword: fixtureCard({
    cardId: "64401acc-d080-4763-b67a-95164c11c69e",
    oracleId: "d79cbc61-6c15-48ea-bbba-3cffb819ccba",
    name: "Sword of the Animist",
    manaCost: "{2}",
    manaValue: 2,
    typeLine: "Legendary Artifact - Equipment",
    oracleText:
      "Equipped creature gets +1/+1. Whenever equipped creature attacks, you may search your library for a basic land card.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/6/4/64401acc-d080-4763-b67a-95164c11c69e.jpg?1689999846",
    imageSmall:
      "https://cards.scryfall.io/small/front/6/4/64401acc-d080-4763-b67a-95164c11c69e.jpg?1689999846",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/6/4/64401acc-d080-4763-b67a-95164c11c69e.jpg?1689999846",
    colors: [],
    colorIdentity: [],
    power: null,
    toughness: null,
    isToken: false,
    supportStatus: "quantity-tracking-only",
  }),
  blanchwood: fixtureCard({
    cardId: "1fd7ec1a-dafa-42ca-bc25-f6848fb03f60",
    oracleId: "80ea56ad-e741-4a85-b4e8-ce62e7d593d5",
    name: "Blanchwood Armor",
    manaCost: "{2}{G}",
    manaValue: 3,
    typeLine: "Enchantment - Aura",
    oracleText:
      "Enchant creature. Enchanted creature gets +1/+1 for each Forest you control.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/1/f/1fd7ec1a-dafa-42ca-bc25-f6848fb03f60.jpg?1730489391",
    imageSmall:
      "https://cards.scryfall.io/small/front/1/f/1fd7ec1a-dafa-42ca-bc25-f6848fb03f60.jpg?1730489391",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/1/f/1fd7ec1a-dafa-42ca-bc25-f6848fb03f60.jpg?1730489391",
    colors: ["G"],
    colorIdentity: ["G"],
    power: null,
    toughness: null,
    isToken: false,
    supportStatus: "quantity-tracking-only",
  }),
  rancor: fixtureCard({
    cardId: "86d6b411-4a31-4bfc-8dd6-e19f553bb29b",
    oracleId: "9d2d6479-531c-4ce1-b52b-00e36fa63b64",
    name: "Rancor",
    manaCost: "{G}",
    manaValue: 1,
    typeLine: "Enchantment - Aura",
    oracleText:
      "Enchant creature. Enchanted creature gets +2/+0 and has trample.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/8/6/86d6b411-4a31-4bfc-8dd6-e19f553bb29b.jpg?1673148169",
    imageSmall:
      "https://cards.scryfall.io/small/front/8/6/86d6b411-4a31-4bfc-8dd6-e19f553bb29b.jpg?1673148169",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/8/6/86d6b411-4a31-4bfc-8dd6-e19f553bb29b.jpg?1673148169",
    colors: ["G"],
    colorIdentity: ["G"],
    power: null,
    toughness: null,
    isToken: false,
    supportStatus: "quantity-tracking-only",
  }),
  allThatGlitters: fixtureCard({
    cardId: "5fc0b82a-f943-4330-b9e7-bb4527354bfd",
    oracleId: "a4d751e0-41c1-4e90-853d-512f385acd81",
    name: "All That Glitters",
    manaCost: "{1}{W}",
    manaValue: 2,
    typeLine: "Enchantment - Aura",
    oracleText:
      "Enchant creature. Enchanted creature gets +1/+1 for each artifact and/or enchantment you control.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/5/f/5fc0b82a-f943-4330-b9e7-bb4527354bfd.jpg?1715600785",
    imageSmall:
      "https://cards.scryfall.io/small/front/5/f/5fc0b82a-f943-4330-b9e7-bb4527354bfd.jpg?1715600785",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/5/f/5fc0b82a-f943-4330-b9e7-bb4527354bfd.jpg?1715600785",
    colors: ["W"],
    colorIdentity: ["W"],
    power: null,
    toughness: null,
    isToken: false,
    supportStatus: "quantity-tracking-only",
  }),
  basilisk: fixtureCard({
    cardId: "7b36fba7-71f7-4b7f-bde5-b3a9752ad21c",
    oracleId: "f5f4dd28-f4ae-4d39-b9b8-6ebfd63c93fe",
    name: "Basilisk Collar",
    manaCost: "{1}",
    manaValue: 1,
    typeLine: "Artifact - Equipment",
    oracleText: "Equipped creature has deathtouch and lifelink. Equip {2}.",
    imageUrl:
      "https://cards.scryfall.io/normal/front/7/b/7b36fba7-71f7-4b7f-bde5-b3a9752ad21c.jpg?1730491131",
    imageSmall:
      "https://cards.scryfall.io/small/front/7/b/7b36fba7-71f7-4b7f-bde5-b3a9752ad21c.jpg?1730491131",
    imageArt:
      "https://cards.scryfall.io/art_crop/front/7/b/7b36fba7-71f7-4b7f-bde5-b3a9752ad21c.jpg?1730491131",
    colors: [],
    colorIdentity: [],
    power: null,
    toughness: null,
    isToken: false,
    supportStatus: "quantity-tracking-only",
  }),
};

export function createReferenceFixtureField(): FieldState {
  const now = new Date("2026-06-25T00:00:00.000Z").toISOString();
  const anim = tracked("fixture-anim-pakal", CARDS.animPakal, 1, 1, {
    counters: { "+1/+1": 8, Shield: 1, Charge: 2 },
    basePower: 2,
    baseToughness: 3,
  });
  const avenger = tracked("fixture-avenger", CARDS.avenger, 1, 2, {
    counters: { "+1/+1": 6 },
    basePower: 10,
    baseToughness: 10,
  });
  const saproling = tracked("fixture-saproling", CARDS.saproling, 12, 3, {
    counters: { "+1/+1": 4 },
    basePower: 3,
    baseToughness: 3,
  });
  const hydra = tracked("fixture-hydra", CARDS.hydra, 1, 4, {
    counters: { "+1/+1": 10, Shield: 2 },
    basePower: 8,
    baseToughness: 8,
  });
  const scute = tracked("fixture-scute", CARDS.scute, 8, 5, {
    counters: { "+1/+1": 5 },
  });
  const champion = tracked("fixture-tapped-creature", CARDS.champion, 1, 6, {
    statuses: { tapped: true },
  });

  const cathars = tracked("fixture-cathars", CARDS.cathars, 1, 20);
  const doubling = tracked("fixture-doubling", CARDS.doubling, 1, 21);
  const solRing = tracked("fixture-sol-ring", CARDS.solRing, 1, 22);
  const ozolith = tracked("fixture-ozolith", CARDS.ozolith, 1, 23);

  const sword = attached("fixture-sword", CARDS.sword, anim.id, 30);
  const blanchwood = attached(
    "fixture-blanchwood",
    CARDS.blanchwood,
    avenger.id,
    31,
  );
  const rancor = attached("fixture-rancor", CARDS.rancor, avenger.id, 32);
  const allThat = attached(
    "fixture-all-that-glitters",
    CARDS.allThatGlitters,
    avenger.id,
    33,
  );
  const basilisk = attached("fixture-basilisk", CARDS.basilisk, ozolith.id, 34);

  const parents = [anim, avenger, ozolith].map((group) => {
    if (group.id === anim.id) return withAttachments(group, [sword.id]);
    if (group.id === avenger.id)
      return withAttachments(group, [blanchwood.id, rancor.id, allThat.id]);
    return withAttachments(group, [basilisk.id]);
  });

  const utilityGroups = [
    landGroup("fixture-basic-lands", "Basic lands", 5, true, 40),
    landGroup("fixture-nonbasic-lands", "Nonbasic lands", 3, false, 41),
    zoneGroup("fixture-hand", "Cards in hand", "hand", 5, 42),
    zoneGroup("fixture-exile", "Cards in exile", "exile", 2, 43),
    resourceGroup(
      "fixture-treasure",
      "Treasure Token",
      12,
      ["Artifact"],
      ["Treasure"],
      true,
      50,
    ),
    resourceGroup(
      "fixture-clue",
      "Clue Token",
      5,
      ["Artifact"],
      ["Clue"],
      true,
      51,
    ),
    resourceGroup(
      "fixture-food",
      "Food Token",
      3,
      ["Artifact"],
      ["Food"],
      true,
      52,
    ),
    resourceGroup(
      "fixture-equipment",
      "Equipment",
      4,
      ["Artifact"],
      ["Equipment"],
      false,
      53,
    ),
    resourceGroup(
      "fixture-other-artifacts",
      "Other Artifacts",
      2,
      ["Artifact"],
      [],
      false,
      54,
    ),
  ];

  return {
    ...createDefaultField(),
    id: "field-reference-fixture",
    name: "Reference Visual Fixture",
    createdAt: now,
    updatedAt: now,
    player: createDefaultPlayer(40),
    opponentValues: createDefaultOpponentValues(),
    groups: [
      ...parents,
      saproling,
      hydra,
      scute,
      champion,
      cathars,
      doubling,
      solRing,
      sword,
      blanchwood,
      rancor,
      allThat,
      basilisk,
      ...utilityGroups,
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

function fixtureCard(input: FixtureCardInput): CardIdentity {
  return {
    ...input,
    cardFaces: [],
    keywords: [],
    loyalty: null,
    defense: null,
    scryfallUri: `https://scryfall.com/card/${input.setCode ?? "fixture"}/${
      input.collectorNumber ?? input.cardId
    }`,
    setCode: input.setCode,
    collectorNumber: input.collectorNumber,
  };
}

function tracked(
  id: string,
  card: CardIdentity,
  quantity: number,
  order: number,
  options: {
    counters?: Record<string, number>;
    statuses?: Partial<PermanentGroup["statuses"]>;
    basePower?: number;
    baseToughness?: number;
  } = {},
): PermanentGroup {
  const group = createCardGroup(card, quantity);
  return finalize({
    ...group,
    id,
    order,
    counters: options.counters ?? {},
    statuses: { ...group.statuses, ...options.statuses },
    pt: {
      ...group.pt,
      basePower: options.basePower ?? group.pt.basePower,
      baseToughness: options.baseToughness ?? group.pt.baseToughness,
    },
  });
}

function attached(
  id: string,
  card: CardIdentity,
  attachedTo: string,
  order: number,
): PermanentGroup {
  const group = createCardGroup(card, 1);
  return finalize({
    ...group,
    id,
    attachedTo,
    order,
  });
}

function withAttachments(group: PermanentGroup, attachments: string[]) {
  return finalize({ ...group, attachments });
}

function landGroup(
  id: string,
  label: string,
  quantity: number,
  basic: boolean,
  order: number,
): PermanentGroup {
  const group = createGenericGroup({
    kind: "Land",
    label,
    quantity,
  });
  return finalize({
    ...group,
    id,
    order,
    characteristics: {
      ...group.characteristics,
      supertypes: basic ? ["Basic"] : [],
      cardTypes: ["Land"],
      subtypes: basic ? ["Forest"] : ["Cave"],
    },
  });
}

function zoneGroup(
  id: string,
  label: string,
  zone: PermanentGroup["zone"],
  quantity: number,
  order: number,
): PermanentGroup {
  const group = createGenericGroup({
    kind: "Custom",
    label,
    quantity,
    zone,
    cardTypes: [],
    subtypes: [],
  });
  return finalize({ ...group, id, order });
}

function resourceGroup(
  id: string,
  label: string,
  quantity: number,
  cardTypes: string[],
  subtypes: string[],
  token: boolean,
  order: number,
): PermanentGroup {
  const group = createGenericGroup({
    kind: "Custom",
    label,
    quantity,
    token,
    cardTypes,
    subtypes,
  });
  return finalize({
    ...group,
    id,
    order,
    isGeneric: true,
    abilitiesActive: false,
    characteristics: {
      ...group.characteristics,
      cardTypes,
      subtypes,
      isCreature: false,
      isToken: token,
    },
    pt: {
      ...group.pt,
      basePower: null,
      baseToughness: null,
      currentPower: null,
      currentToughness: null,
    },
  });
}

function finalize(group: PermanentGroup): PermanentGroup {
  return withStackKey(recalculateStats(group));
}
