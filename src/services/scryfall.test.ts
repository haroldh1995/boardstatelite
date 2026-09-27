import { afterEach, describe, expect, it } from "vitest";
import { configureNetworkPort, resetNetworkPort } from "../platform/network";
import { testCard } from "../test/factories";
import {
  mapScryfallCard,
  rankScryfallResults,
  searchScryfallPage,
} from "./scryfall";

describe("Scryfall search service", () => {
  afterEach(resetNetworkPort);

  it("ranks exact names before prefixes, text, flavor, and metadata", () => {
    const cards = [
      testCard({
        name: "Metadata Result",
        typeLine: "Creature - Noxious",
        oracleText: "",
      }),
      testCard({
        name: "Flavor Result",
        typeLine: "Creature",
        oracleText: "",
        flavorText: "A noxious memory.",
      }),
      testCard({
        name: "Oracle Result",
        typeLine: "Creature",
        oracleText: "Create a noxious cloud.",
      }),
      testCard({
        name: "Noxious Assault",
        typeLine: "Sorcery",
        oracleText: "",
      }),
      testCard({
        name: "Noxious",
        typeLine: "Creature",
        oracleText: "",
      }),
    ];
    expect(
      rankScryfallResults("Noxious", cards).map((card) => card.name),
    ).toEqual([
      "Noxious",
      "Noxious Assault",
      "Oracle Result",
      "Flavor Result",
      "Metadata Result",
    ]);
  });

  it("returns every result on a page and preserves the continuation URL", async () => {
    const rawCards = Array.from({ length: 85 }, (_, index) => ({
      id: `card-${index}`,
      oracle_id: `oracle-${index}`,
      name: `Result ${index}`,
      type_line: "Creature - Test",
      oracle_text: "",
      cmc: 1,
      colors: ["G"],
      color_identity: ["G"],
      keywords: [],
      layout: "normal",
      card_faces: [],
    }));
    let requestedUrl = "";
    configureNetworkPort({
      isOnline: () => true,
      fetchJson: async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: rawCards,
            has_more: true,
            next_page: "https://api.scryfall.com/cards/search?page=2",
          }),
        };
      },
    });
    const page = await searchScryfallPage("Result", {
      pageUrl: "https://api.scryfall.com/cards/search?page=1",
    });
    expect(requestedUrl).toContain("page=1");
    expect(page.cards).toHaveLength(85);
    expect(page.nextPage).toBe("https://api.scryfall.com/cards/search?page=2");
  });

  it("maps flavor text for shared ranking without changing card semantics", () => {
    const card = mapScryfallCard({
      id: "card",
      oracle_id: "oracle",
      name: "Test Card",
      type_line: "Artifact",
      oracle_text: "",
      flavor_text: "Noxious air filled the vault.",
      cmc: 2,
      colors: [],
      color_identity: [],
      keywords: [],
      layout: "normal",
      set: "tst",
      set_name: "Test Set",
      rarity: "rare",
      artist: "Test Artist",
      released_at: "2026-01-01",
    });
    expect(card.flavorText).toBe("Noxious air filled the vault.");
    expect(card.typeLine).toBe("Artifact");
    expect(card.setName).toBe("Test Set");
    expect(card.rarity).toBe("rare");
    expect(card.artist).toBe("Test Artist");
    expect(card.releasedAt).toBe("2026-01-01");
  });

  it("progressively broadens natural search through provider syntax", async () => {
    const requestedUrls: string[] = [];
    configureNetworkPort({
      isOnline: () => true,
      fetchJson: async (url) => {
        requestedUrls.push(url);
        const decoded = decodeURIComponent(url);
        const structured =
          decoded.includes('t:"Mountain"') && decoded.includes('t:"Land"');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: structured
              ? [
                  {
                    id: "mountain",
                    oracle_id: "mountain-oracle",
                    name: "Mountain",
                    type_line: "Basic Land - Mountain",
                    oracle_text: "{T}: Add {R}.",
                    cmc: 0,
                    colors: [],
                    color_identity: ["R"],
                    keywords: [],
                    layout: "normal",
                    card_faces: [],
                  },
                ]
              : [],
            has_more: false,
          }),
        };
      },
    });
    const page = await searchScryfallPage("mountain land");
    expect(page.cards[0]?.name).toBe("Mountain");
    expect(
      requestedUrls.some((url) => {
        const decoded = decodeURIComponent(url);
        return decoded.includes('t:"Mountain"') && decoded.includes('t:"Land"');
      }),
    ).toBe(true);
  });
});
