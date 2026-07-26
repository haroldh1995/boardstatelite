import { searchScryfall } from "../services/scryfall";
import { resolveEchoEntityWithFallback } from "./entityResolution";
import type { EchoEntityResolutionFallbackRequest } from "./entityResolutionTypes";

export function resolveEchoEntityWithScryfallFallback(
  request: Omit<EchoEntityResolutionFallbackRequest, "scryfallSearch">,
) {
  return resolveEchoEntityWithFallback({
    ...request,
    scryfallSearch: (query) => searchScryfall(query),
  });
}
