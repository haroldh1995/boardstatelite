import type {
  ObjectSessionBinding,
  SharedSessionMetadata,
} from "../sharedSession/types";
import type { ModeState } from "../gameModes/types";
import type { MultiplayerState } from "../multiplayer/types";
import type { HubIntegrationState } from "../hub/types";
import type { AmbientGameplayState } from "../echo/ambientTypes";

export type Zone =
  | "battlefield"
  | "hand"
  | "graveyard"
  | "exile"
  | "library"
  | "command";

export type Owner = "you" | "opponent";

export type SupportStatus =
  | "fully-automated"
  | "partially-automated"
  | "quantity-tracking-only"
  | "unsupported";

export type CounterApplicationMode = "game-action" | "correction";

export type StackScope = "one" | "custom" | "all";

export type ModalKind =
  | "startup"
  | "add"
  | "search"
  | "preview"
  | "life"
  | "playerCounters"
  | "managePermanent"
  | "trackingConfirm"
  | "removeStack"
  | "replaceGeneric"
  | "transformAll"
  | "summary"
  | "details"
  | "settings"
  | "exactTotal"
  | "triggerOrder"
  | "customEffect";

export type CounterName =
  | "+1/+1"
  | "-1/-1"
  | "Shield"
  | "Stun"
  | "Finality"
  | "Flying"
  | "First strike"
  | "Double strike"
  | "Deathtouch"
  | "Haste"
  | "Hexproof"
  | "Indestructible"
  | "Lifelink"
  | "Menace"
  | "Reach"
  | "Trample"
  | "Vigilance"
  | "Charge"
  | "Oil"
  | "Time"
  | "Lore"
  | "Loyalty"
  | "Defense"
  | "Level"
  | "Quest"
  | "Age"
  | "Brick"
  | "Verse"
  | (string & {});

export interface StatusFlags {
  tapped: boolean;
  attacking: boolean;
  blocking: boolean;
  summoningSick: boolean;
  phasedOut: boolean;
  transformed: boolean;
  faceDown: boolean;
  exerted: boolean;
  modified: boolean;
  damaged: boolean;
  depowered: boolean;
}

export interface CardFaceIdentity {
  name: string;
  typeLine: string;
  oracleText: string;
  manaCost: string;
  imageUrl: string;
  imageSmall: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
}

export interface CardIdentity {
  cardId: string;
  oracleId?: string;
  name: string;
  manaCost: string;
  manaValue: number;
  typeLine: string;
  oracleText: string;
  imageUrl: string;
  imageSmall: string;
  imageArt: string;
  scryfallUri?: string;
  setCode?: string;
  collectorNumber?: string;
  colors: string[];
  colorIdentity: string[];
  keywords: string[];
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  isToken: boolean;
  cardFaces: CardFaceIdentity[];
  supportStatus: SupportStatus;
}

export interface Characteristics {
  supertypes: string[];
  cardTypes: string[];
  subtypes: string[];
  colors: string[];
  manaValue: number;
  isToken: boolean;
  isCreature: boolean;
  isLegendary: boolean;
}

export interface PowerToughnessState {
  printedPower: number | null;
  printedToughness: number | null;
  basePower: number | null;
  baseToughness: number | null;
  currentPower: number | null;
  currentToughness: number | null;
  temporaryPower: number;
  temporaryToughness: number;
  staticPower: number;
  staticToughness: number;
  powerToughnessSwitch: boolean;
  damage: number;
}

export interface PermanentGroup {
  id: string;
  session?: ObjectSessionBinding;
  quantity: number;
  zone: Zone;
  owner: Owner;
  controller: Owner;
  label: string;
  identity: CardIdentity | null;
  originalIdentity: CardIdentity | null;
  originalCharacteristics: Characteristics | null;
  characteristics: Characteristics;
  counters: Record<string, number>;
  statuses: StatusFlags;
  attachments: string[];
  attachedTo: string | null;
  order: number;
  abilitiesActive: boolean;
  trackingEnabled: boolean;
  depowerMode: "none" | "all" | "triggered" | "selected";
  disabledAbilities: string[];
  isGeneric: boolean;
  notes: string;
  stackKey: string;
  pt: PowerToughnessState;
}

export interface PlayerCounters {
  poison: number;
  energy: number;
  experience: number;
  rad: number;
  commanderDamage: number;
  custom: Record<string, number>;
}

export interface PlayerStatuses {
  monarch: boolean;
  initiative: boolean;
  citysBlessing: boolean;
  dayNight: "off" | "day" | "night";
}

export interface PlayerState {
  life: number;
  startingLife: number;
  counters: PlayerCounters;
  statuses: PlayerStatuses;
}

export interface OpponentValues {
  opponentCreatures: number;
  opponentArtifacts: number;
  opponentCardsInHand: number;
  opponentGraveyardCards: number;
  opponentPermanents: number;
  opponentsWhoLostLife: number;
  numberOfOpponents: number;
  highestOpponentLife: number;
  lowestOpponentLife: number;
  custom: Record<string, number>;
}

export interface SettingsState {
  startingLife: number;
  cardSize: "compact" | "standard" | "large";
  tappedStyle: "rotate" | "badge";
  animationSpeed: "reduced" | "normal" | "fast";
  reducedMotion: boolean;
  backgroundWatchers: boolean;
  optionalEffects: "always" | "never" | "ask";
  triggerOrdering: "auto" | "ask-when-needed";
  themeAccent: "verdant" | "sapphire" | "violet";
  sound: boolean;
  haptics: boolean;
}

export interface WatcherPreferences {
  landEntryMode: "one-at-a-time" | "simultaneous" | "ask" | "correction";
  creatureEntryMode: "simultaneous" | "ask" | "correction";
  artifactEntryMode: "simultaneous" | "ask" | "correction";
}

export interface CustomEffect {
  id: string;
  name: string;
  enabled: boolean;
  trigger:
    | "activate-field"
    | "creature-entered"
    | "land-entered"
    | "life-gained"
    | "life-lost";
  action:
    | {
        kind: "add-counters";
        counter: string;
        target: "all-creatures" | "selected";
        amount: ValueExpression;
      }
    | {
        kind: "create-token";
        name: string;
        amount: ValueExpression;
        power: number;
        toughness: number;
        cardTypes: string[];
        subtypes: string[];
      }
    | {
        kind: "life";
        mode: "gain" | "lose";
        amount: ValueExpression;
      };
}

export type ValueExpression =
  | { type: "fixed"; value: number }
  | { type: "total"; key: RelevantTotalKey }
  | { type: "counter-total"; counter: string }
  | { type: "opponent-value"; key: keyof Omit<OpponentValues, "custom"> };

export interface FieldState {
  schemaVersion: 1;
  id: string;
  session: SharedSessionMetadata;
  mode: ModeState;
  multiplayer: MultiplayerState;
  hub: HubIntegrationState;
  ambient: AmbientGameplayState;
  name: string;
  createdAt: string;
  updatedAt: string;
  player: PlayerState;
  opponentValues: OpponentValues;
  groups: PermanentGroup[];
  pinnedTotals: RelevantTotalKey[];
  customEffects: CustomEffect[];
  settings: SettingsState;
  watcherPreferences: WatcherPreferences;
  orderingPreferences: Record<string, string[]>;
  optionalPreferences: Record<string, boolean>;
  recentSearches: string[];
  recentCards: CardIdentity[];
}

export type RelevantTotalKey =
  | "lands"
  | "basicLands"
  | "nonbasicLands"
  | "plains"
  | "islands"
  | "swamps"
  | "mountains"
  | "forests"
  | "gates"
  | "deserts"
  | "caves"
  | "loci"
  | "spheres"
  | "creatures"
  | "artifacts"
  | "equipment"
  | "enchantments"
  | "auras"
  | "vehicles"
  | "planeswalkers"
  | "battles"
  | "legendaryPermanents"
  | "tokens"
  | "nontokenPermanents"
  | "treasureTokens"
  | "clueTokens"
  | "foodTokens"
  | "bloodTokens"
  | "mapTokens"
  | "powerstones"
  | "cardsInHand"
  | "cardsInGraveyard"
  | "cardsInExile"
  | "cardsRemainingInLibrary"
  | "commanderCasts"
  | "custom";

export interface RelevantTotal {
  key: RelevantTotalKey;
  label: string;
  value: number;
  required: boolean;
  zone?: Zone;
}

export type GameEventType =
  | "permanent-entered"
  | "creature-entered"
  | "token-created"
  | "counter-placed"
  | "counter-removed"
  | "life-gained"
  | "life-lost"
  | "damage-dealt"
  | "land-entered"
  | "spell-cast"
  | "permanent-died"
  | "permanent-sacrificed"
  | "permanent-exiled"
  | "permanent-returned-to-hand"
  | "permanent-transformed"
  | "permanent-tapped"
  | "permanent-untapped";

export interface GameEvent {
  id: string;
  type: GameEventType;
  sourceId: string | null;
  controller: Owner;
  owner: Owner;
  quantity: number;
  batchId: string;
  groupIds: string[];
  characteristics?: Partial<Characteristics>;
  zoneOrigin?: Zone;
  zoneDestination?: Zone;
  token?: boolean;
  damage?: boolean;
  lifeLoss?: boolean;
  combatDamage?: boolean;
  commanderDamage?: boolean;
  metadata: Record<string, string | number | boolean>;
}

export interface ResolutionStep {
  id: string;
  label: string;
  detail: string;
  eventType?: GameEventType;
  sourceName?: string;
  count?: number;
}

export interface ResolutionResult {
  field: FieldState;
  title: string;
  summary: string[];
  details: ResolutionStep[];
  events: GameEvent[];
  changedGroupIds: string[];
  loopDetected: boolean;
  rendering?: {
    source: "lite-helper" | "boardstate-authority";
    authorityLabel: string;
    rulesVersion: string | null;
    validationStatus: "valid" | "invalid" | "recovered";
    animationMode:
      | "instant"
      | "animated"
      | "reduced-motion"
      | "silent"
      | "future-replay";
    warnings: string[];
    unsupportedInteractions: string[];
    judgeNotes: string[];
    replayMarkers: {
      id: string;
      timestamp: string;
      label: string;
      description: string;
    }[];
  };
  accessibilityAnnouncements?: string[];
}

export interface HistoryEntry {
  id: string;
  label: string;
  before: FieldState;
  after: FieldState;
  summary: string[];
  createdAt: string;
}

export interface ModalState {
  kind: ModalKind;
  groupId?: string;
  card?: CardIdentity;
  payload?: unknown;
}
