import { describe, expect, it } from "vitest";
import { testCard } from "../test/factories";
import {
  buildCardSearchPlan,
  createDefaultCardSearchFilters,
  deduplicateCardSearchResults,
  interpretCardSearch,
  rankCardSearchResults,
} from "./cardSearch";

const cards = [
  testCard({
    cardId: "mountain",
    oracleId: "mountain-oracle",
    name: "Mountain",
    typeLine: "Basic Land - Mountain",
    oracleText: "{T}: Add {R}.",
    colors: [],
    colorIdentity: ["R"],
  }),
  testCard({
    cardId: "dragon",
    name: "Shivan Dragon",
    typeLine: "Creature - Dragon",
    oracleText: "Flying",
    colors: ["R"],
    colorIdentity: ["R"],
    keywords: ["Flying"],
    manaValue: 6,
  }),
  testCard({
    cardId: "artifact",
    name: "Arcane Signet",
    typeLine: "Artifact",
    oracleText:
      "{T}: Add one mana of any color in your commander's color identity.",
    manaValue: 2,
  }),
  testCard({
    cardId: "spell",
    name: "Mountain's Fury",
    typeLine: "Instant",
    oracleText: "Destroy target land.",
    colors: ["R"],
  }),
  testCard({
    cardId: "legend",
    name: "Lathliss, Dragon Queen",
    typeLine: "Legendary Creature - Dragon",
    oracleText: "Whenever another nontoken Dragon enters, create a token.",
    colors: ["R"],
    colorIdentity: ["R"],
  }),
  testCard({
    cardId: "blue-flyer",
    name: "Wind Drake",
    typeLine: "Creature - Drake",
    oracleText: "Flying",
    colors: ["U"],
    colorIdentity: ["U"],
    keywords: ["Flying"],
    manaValue: 3,
  }),
  testCard({
    cardId: "three-artifact",
    name: "Chromatic Lantern",
    typeLine: "Artifact",
    oracleText: "Lands you control have an additional mana ability.",
    manaValue: 3,
  }),
];

describe("portable card search intelligence", () => {
  it("recognizes structural natural-language concepts", () => {
    const result = interpretCardSearch({ query: "red dragon creature" });
    expect(result.concepts.map((concept) => concept.label)).toEqual([
      "Red",
      "Dragon",
      "Creature",
    ]);
  });

  it("corrects tolerant structural misspellings without inventing a card name", () => {
    const result = interpretCardSearch({ query: "legandary dragon" });
    expect(result.corrections).toContainEqual({
      from: "legandary",
      to: "legendary",
    });
    expect(result.concepts.map((concept) => concept.label)).toEqual([
      "Legendary",
      "Dragon",
    ]);
  });

  it("keeps ordinary rules-text words broad instead of overcorrecting them", () => {
    const result = interpretCardSearch({ query: "draw cards blue" });
    expect(result.concepts.map((concept) => concept.label)).toEqual(["Blue"]);
    expect(result.textTerms).toEqual(["draw", "cards"]);
  });

  it.each([
    ["red dragon", "Shivan Dragon"],
    ["blue flying creature", "Wind Drake"],
    ["3 mana artifact", "Chromatic Lantern"],
    ["legandary dragon", "Lathliss, Dragon Queen"],
  ])("ranks %s by structure", (query, expected) => {
    expect(rankCardSearchResults({ query }, cards)[0]?.name).toBe(expected);
  });

  it("ranks an actual Mountain land above incidental text matches", () => {
    const ranked = rankCardSearchResults({ query: "mountain land" }, cards);
    expect(ranked[0]?.name).toBe("Mountain");
    expect(ranked.indexOf(cards[0])).toBeLessThan(ranked.indexOf(cards[3]));
  });

  it("prioritizes exact and partial names over Oracle text", () => {
    const exact = rankCardSearchResults({ query: "Arcane Signet" }, cards);
    expect(exact[0]?.name).toBe("Arcane Signet");
    const partial = rankCardSearchResults({ query: "Shivan" }, cards);
    expect(partial[0]?.name).toBe("Shivan Dragon");
  });

  it("combines text with advanced filters", () => {
    const filters = createDefaultCardSearchFilters();
    filters.cardTypes = ["Creature"];
    filters.colors = ["U"];
    filters.manaValue = 3;
    const ranked = rankCardSearchResults({ query: "flying", filters }, cards);
    expect(ranked[0]?.name).toBe("Wind Drake");
  });

  it("supports filter-only plans and provider syntax", () => {
    const filters = createDefaultCardSearchFilters();
    filters.cardTypes = ["Instant"];
    filters.manaValue = 3;
    filters.manaValueOperator = "at-most";
    const plan = buildCardSearchPlan({ query: "", filters });
    expect(plan[0]?.query).toContain('t:"Instant"');
    expect(plan[0]?.query).toContain("mv<=3");
  });

  it("builds progressive fallback stages without duplicate provider queries", () => {
    const plan = buildCardSearchPlan({ query: "legandary dragon" });
    expect(plan.map((stage) => stage.id)).toContain("structured");
    expect(plan.map((stage) => stage.id)).toContain("fuzzy");
    expect(new Set(plan.map((stage) => stage.query)).size).toBe(plan.length);
  });

  it("deduplicates merged provider candidates by printing", () => {
    expect(
      deduplicateCardSearchResults([cards[0], { ...cards[0] }, cards[1]]),
    ).toHaveLength(2);
  });
});
