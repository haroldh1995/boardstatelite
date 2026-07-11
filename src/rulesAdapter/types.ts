import type {
  CardIdentity,
  Characteristics,
  CounterName,
  FieldState,
  GameEvent,
  Owner,
  PermanentGroup,
  PlayerCounters,
  PlayerStatuses,
  RelevantTotalKey,
  ResolutionStep,
  SupportStatus,
  Zone,
} from "../domain/types";
import type { SharedSessionSnapshot } from "../sharedSession/types";

export const RULES_ADAPTER_VERSION = "0.1.0";
export const RULES_ADAPTER_SERIALIZATION_VERSION = 1;
export const LITE_SNAPSHOT_VERSION = 1;
export const LITE_APP_VERSION = "0.0.0";
export const MINIMUM_BOARDSTATE_VERSION = "0.1.0";

export type RulesAdapterStatus =
  | "unavailable"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "unsupportedVersion";

export type RulesAdapterCapability =
  | "evaluateSnapshot"
  | "sharedSession"
  | "advancedMode"
  | "multiplayerAuthority"
  | "dryRun"
  | "tutorialAuthority"
  | "rulesReplay"
  | "deckValidation";

export type RulesAdapterCapabilityMap = Record<RulesAdapterCapability, boolean>;

export interface RulesAdapterVersionInfo {
  liteVersion: string;
  adapterVersion: string;
  serializationVersion: number;
  snapshotVersion: number;
  minimumBoardStateVersion: string;
  expectedBoardStateVersion: string | null;
}

export interface RulesAdapterDiagnostics {
  status: RulesAdapterStatus;
  capabilities: RulesAdapterCapabilityMap;
  version: RulesAdapterVersionInfo;
  lastAttemptedEvaluation: {
    at: string;
    fieldId: string;
    snapshotVersion: number;
    serializationVersion: number;
    snapshotHash: string | null;
  } | null;
  fallbackReason: string | null;
  lastAdapterError: string | null;
  currentEngine: "lite-helper" | "boardstate-authority";
}

export interface LiteFieldSnapshot {
  metadata: {
    appName: "Baord State Lite";
    appVersion: string;
    fieldId: string;
    fieldName: string;
    fieldSchemaVersion: FieldState["schemaVersion"];
    snapshotVersion: number;
    serializationVersion: number;
    rulesAdapterVersion: string;
    timestamp: string;
  };
  session: SharedSessionSnapshot;
  player: {
    life: number;
    startingLife: number;
    counters: PlayerCounters;
    statuses: PlayerStatuses;
  };
  relevantTotals: Partial<Record<RelevantTotalKey, number>>;
  opponentValues: FieldState["opponentValues"];
  battlefield: LitePermanentSnapshot[];
  customEffects: FieldState["customEffects"];
  preferences: {
    watcherPreferences: FieldState["watcherPreferences"];
    orderingPreferences: FieldState["orderingPreferences"];
    optionalPreferences: FieldState["optionalPreferences"];
  };
}

export interface LitePermanentSnapshot {
  stableId: string;
  sessionId: string;
  objectId: string;
  objectIds: string[];
  ownerParticipantId: string;
  controllerParticipantId: string;
  label: string;
  cardIdentity: LiteCardIdentitySnapshot | null;
  printing: {
    setCode: string | null;
    collectorNumber: string | null;
    scryfallId: string | null;
    oracleId: string | null;
  };
  quantity: number;
  token: boolean;
  genericPlaceholder: boolean;
  trackingEnabled: boolean;
  depowerState: {
    abilitiesActive: boolean;
    mode: PermanentGroup["depowerMode"];
    disabledAbilities: string[];
  };
  controller: Owner;
  owner: Owner;
  position: number;
  zone: Zone;
  attachments: string[];
  attachedTo: string | null;
  counters: Record<CounterName, number>;
  basePowerToughness: {
    printedPower: number | null;
    printedToughness: number | null;
    basePower: number | null;
    baseToughness: number | null;
  };
  currentPowerToughness: {
    currentPower: number | null;
    currentToughness: number | null;
    temporaryPower: number;
    temporaryToughness: number;
    staticPower: number;
    staticToughness: number;
    powerToughnessSwitch: boolean;
    damage: number;
  };
  temporaryEffects: [];
  transformState: {
    transformed: boolean;
    originalIdentity: LiteCardIdentitySnapshot | null;
    originalCharacteristics: Characteristics | null;
  };
  statusFlags: PermanentGroup["statuses"];
  characteristics: Characteristics;
  stackMembership: {
    stackKey: string;
    quantity: number;
  };
}

export interface LiteCardIdentitySnapshot {
  cardId: string;
  oracleId: string | null;
  name: string;
  manaCost: string;
  manaValue: number;
  typeLine: string;
  oracleText: string;
  setCode: string | null;
  collectorNumber: string | null;
  colors: string[];
  colorIdentity: string[];
  keywords: string[];
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  isToken: boolean;
  supportStatus: SupportStatus;
}

export type RulesChangeRecord =
  | {
      kind: "life";
      player: Owner;
      mode: "gain" | "loss" | "damage" | "pay" | "set";
      amount: number;
    }
  | {
      kind: "counter";
      groupId: string;
      counter: string;
      amount: number;
      mode: "placed" | "removed" | "set";
    }
  | {
      kind: "token";
      groupId: string | null;
      name: string;
      quantity: number;
      mode: "created" | "removed";
    }
  | {
      kind: "zone";
      groupId: string;
      from: Zone;
      to: Zone;
      quantity: number;
    }
  | {
      kind: "attachment";
      attachmentId: string;
      hostId: string | null;
      mode: "attached" | "detached";
    }
  | {
      kind: "battlefield";
      groupId: string;
      message: string;
    };

export interface BoardStateRulesEvaluation {
  ok: boolean;
  source: "boardstate-authority";
  rulesVersion: string;
  triggerList: ResolutionStep[];
  replacementEffects: ResolutionStep[];
  staticRecalculations: ResolutionStep[];
  battlefieldChanges: RulesChangeRecord[];
  lifeChanges: RulesChangeRecord[];
  counterChanges: RulesChangeRecord[];
  tokenChanges: RulesChangeRecord[];
  attachments: RulesChangeRecord[];
  zoneChanges: RulesChangeRecord[];
  messages: string[];
  warnings: string[];
  unsupportedInteractions: string[];
  events: GameEvent[];
}

export interface RulesAdapterEvaluationOutcome {
  kind: "authority-result" | "fallback";
  result: BoardStateRulesEvaluation | null;
  fallbackReason: string | null;
  snapshot: LiteFieldSnapshot | null;
  serializedSnapshot: string | null;
}

export interface BoardStateRulesAdapter {
  readonly status: RulesAdapterStatus;
  getCapabilities(): RulesAdapterCapabilityMap;
  evaluateSnapshot(
    snapshot: LiteFieldSnapshot,
  ): Promise<BoardStateRulesEvaluation>;
}

export type LiteHelperResolver<T> = () => T;

export type CardIdentityLike = Pick<
  CardIdentity,
  | "cardId"
  | "oracleId"
  | "name"
  | "manaCost"
  | "manaValue"
  | "typeLine"
  | "oracleText"
  | "setCode"
  | "collectorNumber"
  | "colors"
  | "colorIdentity"
  | "keywords"
  | "power"
  | "toughness"
  | "loyalty"
  | "defense"
  | "isToken"
  | "supportStatus"
>;
