import { createDefaultField } from "./field";
import type { FieldState } from "./types";

export function createNewGame(previous: FieldState): FieldState {
  const fresh = createDefaultField();
  return {
    ...fresh,
    settings: previous.settings,
    hub: previous.hub,
    pinnedTotals: previous.pinnedTotals,
    watcherPreferences: previous.watcherPreferences,
    optionalPreferences: previous.optionalPreferences,
    pronunciationLearning: {
      ...fresh.pronunciationLearning,
      entries: previous.pronunciationLearning.entries,
      playerAliases: previous.pronunciationLearning.playerAliases,
      playgroupVocabulary: previous.pronunciationLearning.playgroupVocabulary,
    },
    personalGameplay: {
      ...fresh.personalGameplay,
      preferences: previous.personalGameplay.preferences,
      observations: previous.personalGameplay.observations.filter(
        (entry) => !entry.context.sessionId,
      ),
    },
    argus: { ...fresh.argus, enabled: previous.argus.enabled },
  };
}
