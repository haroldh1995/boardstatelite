import { afterEach, describe, expect, it } from "vitest";
import { hubIntegrationManager } from "./manager";
import { testCard } from "../test/factories";
import { searchCards } from "../services/cardSearch";
import { normalizeDeckSnapshot } from "../domain/deckSnapshot";

afterEach(() => hubIntegrationManager.deckNexus.install(null));
describe("Deck Nexus adapter contract", () => {
  it("reports disconnected access without inventing decks", async () => {
    expect(hubIntegrationManager.deckNexus.available).toBe(false);
    expect(await hubIntegrationManager.deckNexus.listDecks()).toEqual([]);
  });
  it("normalizes and detaches a session snapshot from subsequent Nexus edits", async () => {
    const card = testCard({
      name: "Sol Ring",
      typeLine: "Artifact",
      oracleText: "{T}: Add {C}{C}.",
    });
    const raw = {
      deckId: "one",
      name: "My Deck",
      cards: [{ ...card, quantity: 1 }],
    };
    hubIntegrationManager.deckNexus.install({
      listDecks: async () => [
        { id: "one", name: "My Deck", commanderNames: [] },
      ],
      snapshot: async () => raw,
    });
    expect(await hubIntegrationManager.deckNexus.listDecks()).toHaveLength(1);
    const result = await hubIntegrationManager.deckNexus.snapshot("one");
    raw.cards[0].oracleText = "Edited later";
    expect(result?.cards[0].identity.oracleText).toBe(card.oracleText);
    expect(
      await hubIntegrationManager.deckNexus.snapshot("deleted"),
    ).toBeNull();
  });
  it("searches a snapshot offline and includes basic land identities not saved in the list", async () => {
    const deck = normalizeDeckSnapshot({
      deckId: "one",
      name: "Offline",
      cards: [],
    });
    const results = await searchCards({
      query: "mountain land",
      scope: "my-deck",
      deck,
    });
    expect(results.cards[0].name).toBe("Mountain");
    expect(results.nextPage).toBeNull();
  });
});
