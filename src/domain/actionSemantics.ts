export type GameplayMutationKind = "game-action" | "correction" | "observation";

export type GameplayAuthoritySource =
  | "explicit-player-input"
  | "battlefield-reconciliation"
  | "multimodal-observation"
  | "single-source-observation"
  | "athena-inference";

export type ObservationConfidence =
  | "confirmed"
  | "probable"
  | "uncertain"
  | "unknown";

const AUTHORITY_RANK: Record<GameplayAuthoritySource, number> = {
  "explicit-player-input": 5,
  "battlefield-reconciliation": 4,
  "multimodal-observation": 3,
  "single-source-observation": 2,
  "athena-inference": 1,
};

export interface GameplayProvenance {
  kind: GameplayMutationKind;
  authority: GameplayAuthoritySource;
  sourceId: string | null;
  recordedAt: string;
  explicit: boolean;
}

export function compareGameplayAuthority(
  left: GameplayAuthoritySource,
  right: GameplayAuthoritySource,
): number {
  return AUTHORITY_RANK[left] - AUTHORITY_RANK[right];
}

export function explicitPlayerProvenance(
  timestamp = new Date().toISOString(),
  kind: Exclude<GameplayMutationKind, "observation"> = "game-action",
): GameplayProvenance {
  return {
    kind,
    authority:
      kind === "correction"
        ? "battlefield-reconciliation"
        : "explicit-player-input",
    sourceId: null,
    recordedAt: timestamp,
    explicit: true,
  };
}

export function observationRequiresAcceptance(
  confidence: ObservationConfidence,
): boolean {
  return confidence !== "confirmed";
}

export function canGenerateGameplayTriggers(
  provenance: GameplayProvenance,
): boolean {
  return provenance.kind === "game-action";
}
