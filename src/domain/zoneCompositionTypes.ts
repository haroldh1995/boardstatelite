export const ZONE_COMPOSITION_VERSION = 1;
export const ZONE_COMPOSITION_COLLECTION_VERSION = 1;

export type CategoricalZone = "graveyard" | "exile";

export type ZoneCardTypeCategory =
  | "creature"
  | "artifact"
  | "enchantment"
  | "instant"
  | "sorcery"
  | "land"
  | "planeswalker"
  | "battle"
  | "kindred";

export type ZoneCharacteristicCategory =
  | "legendary"
  | "token"
  | "nontoken"
  | "commander"
  | "historic";

export type ZoneColorCategory =
  | "white"
  | "blue"
  | "black"
  | "red"
  | "green"
  | "colorless"
  | "multicolor";

export type ZoneCategoryKey =
  | ZoneCardTypeCategory
  | ZoneCharacteristicCategory
  | ZoneColorCategory
  | `subtype:${string}`;

export type ZoneCategoryRelevantTotalKey =
  `${CategoricalZone}.${ZoneCategoryKey}`;

export type ZoneCompositionAuthoritySource =
  | "local-canonical"
  | "manual-correction"
  | "deck-snapshot"
  | "scryfall-reconciliation"
  | "boardstate-authority"
  | "imported";

export interface ZoneAuthorityCategoryTotal {
  value: number;
  reference: string;
  updatedAt: string;
}

export interface ZoneCompositionState {
  version: typeof ZONE_COMPOSITION_VERSION;
  zone: CategoricalZone;
  manualMemberships: Partial<Record<ZoneCategoryKey, number>>;
  exactCategoryKeys: ZoneCategoryKey[];
  manuallyAccountedPhysicalCards: number;
  unknownPhysicalCardsAtUpdate: number;
  trackedCategoryKeys: ZoneCategoryKey[];
  authorityCategoryTotals: Partial<
    Record<ZoneCategoryKey, ZoneAuthorityCategoryTotal>
  >;
  updatedAt: string;
}

export interface ZoneCommanderIdentity {
  cardId: string;
  name: string;
  colorIdentity: string[];
  source: "canonical-card" | "deck-snapshot" | "imported";
  updatedAt: string;
}

export interface ZoneCompositionCollectionState {
  version: typeof ZONE_COMPOSITION_COLLECTION_VERSION;
  commander: ZoneCommanderIdentity | null;
  graveyard: ZoneCompositionState;
  exile: ZoneCompositionState;
}

export interface ZoneCategorySnapshot {
  key: ZoneCategoryKey;
  dependencyKey: ZoneCategoryRelevantTotalKey;
  label: string;
  kind: "card-type" | "characteristic" | "color" | "subtype";
  value: number;
  knownValue: number;
  manualValue: number;
  exact: boolean;
  status: "exact" | "partial";
  authoritySource: ZoneCompositionAuthoritySource;
  authorityReference: string | null;
}

export interface ZoneCompositionSnapshot {
  version: typeof ZONE_COMPOSITION_VERSION;
  zone: CategoricalZone;
  physicalTotal: number;
  knownPhysicalCards: number;
  manuallyAccountedPhysicalCards: number;
  accountedPhysicalCards: number;
  unaccountedPhysicalCards: number;
  categories: ZoneCategorySnapshot[];
  categoryTotals: Partial<Record<ZoneCategoryKey, number>>;
  exactCategoryKeys: ZoneCategoryKey[];
  partialCategoryKeys: ZoneCategoryKey[];
  authoritativeCategoryKeys: ZoneCategoryKey[];
  dynamicSubtypeKeys: ZoneCategoryKey[];
  completelyAccounted: boolean;
  semanticDescription: string;
}

export interface ZoneDeckSnapshotCard {
  cardId: string;
  name: string;
  typeLine?: string;
  oracleText?: string;
  colors?: string[];
  colorIdentity?: string[];
  manaValue?: number;
  isToken?: boolean;
  isCommander?: boolean;
  quantity?: number;
}

export interface ZoneCompositionCorrectionInput {
  zone: CategoricalZone;
  physicalTotal?: number;
  categoryTotals?: Partial<Record<ZoneCategoryKey, number>>;
  manuallyAccountedPhysicalCards?: number;
  selectedCategoryKeys?: ZoneCategoryKey[];
  timestamp?: string;
}

export interface ZoneCompositionCommandResult<TField> {
  ok: boolean;
  field: TField;
  reason: string;
  summary: string[];
  changedCategoryKeys: ZoneCategoryKey[];
  correctionOnly: true;
  gameplayEventsGenerated: false;
  replacementEffectsApplied: false;
  triggerInstancesGenerated: 0;
  consequenceEventsGenerated: 0;
}
