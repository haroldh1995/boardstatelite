// Verified against Scryfall Oracle records and CR 309 / 701.49 / 726 (2026-09-25).
// Identifiers are Oracle identities, not localized display names. See docs/DUNGEONS.md.
export type DungeonEffect =
  | {
      kind: "life";
      amount: number;
      audience: "you" | "each-player" | "target-player" | "opponents-and-you";
    }
  | { kind: "counters"; amount: number }
  | {
      kind: "token";
      name: string;
      quantity: number;
      power: number;
      toughness: number;
      colors: string[];
      types: string[];
      subtypes: string[];
      keywords: string[];
      legendary?: boolean;
    }
  | {
      kind: "manual";
      action:
        | "scry"
        | "draw"
        | "search"
        | "reveal"
        | "choice"
        | "restriction"
        | "exile"
        | "goad"
        | "sacrifice";
    };
export interface DungeonRoom {
  id: string;
  name: string;
  text: string;
  next: string[];
  row: number;
  column: number;
  effect: DungeonEffect;
}
export interface DungeonDefinition {
  id: string;
  cardId: string;
  name: string;
  undercity: boolean;
  imageUrl: string;
  rooms: DungeonRoom[];
}
const room = (
  id: string,
  name: string,
  text: string,
  next: string[],
  row: number,
  column: number,
  effect: DungeonEffect,
): DungeonRoom => ({ id, name, text, next, row, column, effect });
const manual = (
  action: Extract<DungeonEffect, { kind: "manual" }>["action"],
): DungeonEffect => ({ kind: "manual", action });
const treasure: DungeonEffect = {
  kind: "token",
  name: "Treasure",
  quantity: 1,
  power: 0,
  toughness: 0,
  colors: [],
  types: ["Artifact"],
  subtypes: ["Treasure"],
  keywords: [],
};
const image = (id: string) =>
  `https://cards.scryfall.io/large/front/${id[0]}/${id[1]}/${id}.jpg`;
export const DUNGEONS: DungeonDefinition[] = [
  {
    id: "5c446a7f-0301-4343-b0df-146cf2db605b",
    cardId: "59b11ff8-f118-4978-87dd-509dc0c8c932",
    name: "Lost Mine of Phandelver",
    undercity: false,
    imageUrl: image("59b11ff8-f118-4978-87dd-509dc0c8c932"),
    rooms: [
      room(
        "entrance",
        "Cave Entrance",
        "Scry 1.",
        ["goblin", "tunnels"],
        0,
        1,
        manual("scry"),
      ),
      room(
        "goblin",
        "Goblin Lair",
        "Create a 1/1 red Goblin creature token.",
        ["storeroom", "pool"],
        1,
        0,
        {
          kind: "token",
          name: "Goblin",
          quantity: 1,
          power: 1,
          toughness: 1,
          colors: ["R"],
          types: ["Creature"],
          subtypes: ["Goblin"],
          keywords: [],
        },
      ),
      room(
        "tunnels",
        "Mine Tunnels",
        "Create a Treasure token.",
        ["pool", "fungi"],
        1,
        2,
        treasure,
      ),
      room(
        "storeroom",
        "Storeroom",
        "Put a +1/+1 counter on target creature.",
        ["temple"],
        2,
        0,
        { kind: "counters", amount: 1 },
      ),
      room(
        "pool",
        "Dark Pool",
        "Each opponent loses 1 life and you gain 1 life.",
        ["temple"],
        2,
        1,
        { kind: "life", amount: 1, audience: "opponents-and-you" },
      ),
      room(
        "fungi",
        "Fungi Cavern",
        "Target creature gets -4/-0 until your next turn.",
        ["temple"],
        2,
        2,
        manual("restriction"),
      ),
      room(
        "temple",
        "Temple of Dumathoin",
        "Draw a card.",
        [],
        3,
        1,
        manual("draw"),
      ),
    ],
  },
  {
    id: "30d0398c-bf5a-4b30-936f-afdb5a109b4b",
    cardId: "6f509dbe-6ec7-4438-ab36-e20be46c9922",
    name: "Dungeon of the Mad Mage",
    undercity: false,
    imageUrl: image("6f509dbe-6ec7-4438-ab36-e20be46c9922"),
    rooms: [
      room("portal", "Yawning Portal", "You gain 1 life.", ["level"], 0, 1, {
        kind: "life",
        amount: 1,
        audience: "you",
      }),
      room(
        "level",
        "Dungeon Level",
        "Scry 1.",
        ["bazaar", "caverns"],
        1,
        1,
        manual("scry"),
      ),
      room(
        "bazaar",
        "Goblin Bazaar",
        "Create a Treasure token.",
        ["lost"],
        2,
        0,
        treasure,
      ),
      room(
        "caverns",
        "Twisted Caverns",
        "Target creature can't attack until your next turn.",
        ["lost"],
        2,
        2,
        manual("restriction"),
      ),
      room(
        "lost",
        "Lost Level",
        "Scry 2.",
        ["runestone", "graveyard"],
        3,
        1,
        manual("scry"),
      ),
      room(
        "runestone",
        "Runestone Caverns",
        "Exile the top two cards of your library. You may play them.",
        ["mines"],
        4,
        0,
        manual("exile"),
      ),
      room(
        "graveyard",
        "Muiral's Graveyard",
        "Create two 1/1 black Skeleton creature tokens.",
        ["mines"],
        4,
        2,
        {
          kind: "token",
          name: "Skeleton",
          quantity: 2,
          power: 1,
          toughness: 1,
          colors: ["B"],
          types: ["Creature"],
          subtypes: ["Skeleton"],
          keywords: [],
        },
      ),
      room("mines", "Deep Mines", "Scry 3.", ["lair"], 5, 1, manual("scry")),
      room(
        "lair",
        "Mad Wizard's Lair",
        "Draw three cards and reveal them. You may cast one of them without paying its mana cost.",
        [],
        6,
        1,
        manual("reveal"),
      ),
    ],
  },
  {
    id: "d2ea2605-0ca0-4782-851d-e706bd0114e4",
    cardId: "70b284bd-7a8f-4b60-8238-f746bdc5b236",
    name: "Tomb of Annihilation",
    undercity: false,
    imageUrl: image("70b284bd-7a8f-4b60-8238-f746bdc5b236"),
    rooms: [
      room(
        "entry",
        "Trapped Entry",
        "Each player loses 1 life.",
        ["veils", "oubliette"],
        0,
        1,
        { kind: "life", amount: -1, audience: "each-player" },
      ),
      room(
        "veils",
        "Veils of Fear",
        "Each player loses 2 life unless they discard a card.",
        ["sandfall"],
        1,
        0,
        manual("choice"),
      ),
      room(
        "sandfall",
        "Sandfall Cell",
        "Each player loses 2 life unless they sacrifice a creature, artifact, or land of their choice.",
        ["cradle"],
        2,
        0,
        manual("choice"),
      ),
      room(
        "oubliette",
        "Oubliette",
        "Discard a card and sacrifice a creature, an artifact, and a land.",
        ["cradle"],
        1,
        2,
        manual("sacrifice"),
      ),
      room(
        "cradle",
        "Cradle of the Death God",
        "Create The Atropal, a legendary 4/4 black God Horror creature token with deathtouch.",
        [],
        3,
        1,
        {
          kind: "token",
          name: "The Atropal",
          quantity: 1,
          power: 4,
          toughness: 4,
          colors: ["B"],
          types: ["Creature"],
          subtypes: ["God", "Horror"],
          keywords: ["Deathtouch"],
          legendary: true,
        },
      ),
    ],
  },
  {
    id: "36b61021-72f0-4c22-a41d-9b2f093d7ca8",
    cardId: "2c65185b-6cf0-451d-985e-56aa45d9a57d",
    name: "Undercity",
    undercity: true,
    imageUrl: image("2c65185b-6cf0-451d-985e-56aa45d9a57d"),
    rooms: [
      room(
        "entrance",
        "Secret Entrance",
        "Search your library for a basic land card, reveal it, put it into your hand, then shuffle.",
        ["forge", "well"],
        0,
        1,
        manual("search"),
      ),
      room(
        "forge",
        "Forge",
        "Put two +1/+1 counters on target creature.",
        ["trap", "arena"],
        1,
        0,
        { kind: "counters", amount: 2 },
      ),
      room(
        "well",
        "Lost Well",
        "Scry 2.",
        ["arena", "stash"],
        1,
        2,
        manual("scry"),
      ),
      room("trap", "Trap!", "Target player loses 5 life.", ["archives"], 2, 0, {
        kind: "life",
        amount: -5,
        audience: "target-player",
      }),
      room(
        "arena",
        "Arena",
        "Goad target creature.",
        ["archives", "catacombs"],
        2,
        1,
        manual("goad"),
      ),
      room(
        "stash",
        "Stash",
        "Create a Treasure token.",
        ["catacombs"],
        2,
        2,
        treasure,
      ),
      room(
        "archives",
        "Archives",
        "Draw a card.",
        ["throne"],
        3,
        0,
        manual("draw"),
      ),
      room(
        "catacombs",
        "Catacombs",
        "Create a 4/1 black Skeleton creature token with menace.",
        ["throne"],
        3,
        2,
        {
          kind: "token",
          name: "Skeleton",
          quantity: 1,
          power: 4,
          toughness: 1,
          colors: ["B"],
          types: ["Creature"],
          subtypes: ["Skeleton"],
          keywords: ["Menace"],
        },
      ),
      room(
        "throne",
        "Throne of the Dead Three",
        "Reveal the top ten cards of your library. Put a creature card from among them onto the battlefield with three +1/+1 counters on it. It gains hexproof until your next turn. Then shuffle.",
        [],
        4,
        1,
        manual("reveal"),
      ),
    ],
  },
];
export const dungeonById = (id: string | null | undefined) =>
  DUNGEONS.find((entry) => entry.id === id || entry.cardId === id);
export const dungeonRoom = (dungeonId: string, roomId: string) =>
  dungeonById(dungeonId)?.rooms.find((entry) => entry.id === roomId);
