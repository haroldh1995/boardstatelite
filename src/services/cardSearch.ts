import {
  localSearchCandidates,
  rankContextualCards,
  type ContextualCardSearchRequest,
} from "../domain/contextualCardSearch";
import { interpretCardSearch } from "../domain/cardSearch";
import { createBasicLandIdentity } from "../athena/turnIntent";
import {
  searchScryfallPage,
  type ScryfallSearchOptions,
  type ScryfallSearchPage,
} from "./scryfall";

export async function searchCards(
  request: ContextualCardSearchRequest,
  options: ScryfallSearchOptions = {},
): Promise<ScryfallSearchPage> {
  const local = localSearchCandidates(request);
  if (request.scope === "my-deck" && request.deck && !options.pageUrl) {
    const landIntent = interpretCardSearch(request).concepts.some(
      (concept) =>
        concept.value === "Land" ||
        ["Plains", "Island", "Swamp", "Mountain", "Forest"].includes(
          concept.value,
        ),
    );
    const lands = landIntent
      ? ["Plains", "Island", "Swamp", "Mountain", "Forest"].flatMap((name) => {
          const card = createBasicLandIdentity(name);
          return card ? [card] : [];
        })
      : [];
    return {
      cards: rankContextualCards(request, [...local, ...lands]),
      nextPage: null,
      fromCache: true,
    };
  }
  const page = await searchScryfallPage(request.query, {
    ...options,
    filters: request.filters,
    ignoredConceptIds: request.ignoredConceptIds,
  });
  if (options.signal?.aborted)
    return { cards: [], nextPage: null, fromCache: false };
  // Current provider data wins when the local snapshot is stale.
  const merged = [
    ...page.cards,
    ...local.filter(
      (entry) =>
        !page.cards.some(
          (card) =>
            (card.oracleId && card.oracleId === entry.oracleId) ||
            card.name === entry.name,
        ),
    ),
  ];
  return { ...page, cards: rankContextualCards(request, merged) };
}
