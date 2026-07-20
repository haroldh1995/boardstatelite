import type { FieldState, RelevantTotalKey } from "../domain/types";
import type { LiteFieldSnapshot } from "../rulesAdapter";

export const ECHO_FOUNDATION_VERSION = 1;
export const ECHO_COMPATIBILITY_VERSION = "0.1.0";

export const ECHO_CAPABILITIES = [
  "ambientGameplayEngine",
  "passiveMode",
  "activeTurnMode",
  "recoveryMode",
  "combatMode",
  "resolutionMode",
  "turnPlanner",
  "actionPipeline",
  "voiceServices",
  "speakerVerification",
  "magicCommandGrammar",
  "cardRecognition",
  "combatPrediction",
  "aiRecommendations",
  "userLearning",
] as const;

export type EchoCapability = (typeof ECHO_CAPABILITIES)[number];
export type EchoCapabilityMap = Record<EchoCapability, boolean>;

export type EchoFoundationStatus = "dormant";

export interface EchoPermanentContext {
  groupId: string;
  objectIds: string[];
  label: string;
  zone: FieldState["groups"][number]["zone"];
  quantity: number;
  cardTypes: string[];
  subtypes: string[];
  counters: Record<string, number>;
  statuses: FieldState["groups"][number]["statuses"];
  trackingEnabled: boolean;
  abilitiesActive: boolean;
  depowerMode: FieldState["groups"][number]["depowerMode"];
  isGeneric: boolean;
  isToken: boolean;
  currentPower: number | null;
  currentToughness: number | null;
}

export interface EchoAmbientContext {
  version: typeof ECHO_FOUNDATION_VERSION;
  compatibilityVersion: typeof ECHO_COMPATIBILITY_VERSION;
  createdAt: string;
  fieldId: string;
  sessionId: string;
  localParticipantId: string;
  currentMode: "simple";
  authority: "local-lite";
  status: EchoFoundationStatus;
  capabilities: EchoCapabilityMap;
  player: FieldState["player"];
  relevantTotals: Record<RelevantTotalKey, number>;
  battlefield: EchoPermanentContext[];
  liteSnapshot: LiteFieldSnapshot;
  boundaries: {
    authoritativeRulesAvailable: false;
    hubAvailable: false;
    networkingAvailable: false;
    userFacingEchoEnabled: false;
  };
}

export interface EchoFoundationDiagnostics {
  status: EchoFoundationStatus;
  compatibilityVersion: typeof ECHO_COMPATIBILITY_VERSION;
  capabilities: EchoCapabilityMap;
  currentMode: "simple";
  authority: "local-lite";
  localOnly: true;
  userFacingEchoEnabled: false;
  lastContextAt: string | null;
  lastFieldId: string | null;
}
