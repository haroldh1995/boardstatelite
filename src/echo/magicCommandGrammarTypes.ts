import type { Owner } from "../domain/types";
import type { AmbientGameplayMode } from "./ambientTypes";
import type {
  AmbientCorrectionType,
  AmbientConfidenceAssessment,
} from "./ambientConfidenceTypes";
import type {
  AmbientEntityReference,
  AmbientIntentInput,
  AmbientIntentKind,
} from "./ambientEventTypes";
import type { EchoSpeakerVerificationResult } from "./speakerVerificationTypes";

export const ECHO_MAGIC_COMMAND_GRAMMAR_VERSION = 1;

export type EchoMagicCommandLocale = "en-US";

export type EchoMagicCommandStatus =
  | "recognized"
  | "ambiguous"
  | "incomplete"
  | "unknown"
  | "rejected"
  | "disabled";

export type EchoMagicCommandAction =
  | "play"
  | "cast"
  | "attack"
  | "block"
  | "create"
  | "sacrifice"
  | "destroy"
  | "exile"
  | "return"
  | "draw"
  | "discard"
  | "tap"
  | "untap"
  | "add-mana"
  | "add-counter"
  | "remove-counter"
  | "counter-spell"
  | "pass-priority"
  | "end-turn"
  | "hold-priority"
  | "activate"
  | "equip"
  | "attach"
  | "transform"
  | "explore"
  | "surveil"
  | "mill";

export type EchoMagicCommandObjectKind =
  | "battlefield-object"
  | "card"
  | "commander"
  | "token"
  | "player"
  | "counter"
  | "zone"
  | "land"
  | "mana"
  | "mechanic"
  | "unknown";

export interface EchoMagicCommandObjectMatch {
  kind: EchoMagicCommandObjectKind;
  label: string;
  normalizedLabel: string;
  confidence: number;
  entity: AmbientEntityReference | null;
  payload: Record<string, string | number | boolean | null>;
}

export interface EchoMagicCommandObject {
  kind: EchoMagicCommandObjectKind;
  text: string;
  normalizedText: string;
  quantity: number | null;
  matches: EchoMagicCommandObjectMatch[];
  selectedMatch: EchoMagicCommandObjectMatch | null;
  ambiguous: boolean;
  missing: boolean;
}

export interface EchoMagicCommandAmbiguity {
  type:
    | "missing-object"
    | "multiple-objects"
    | "missing-quantity"
    | "unknown-object"
    | "unsupported-mechanic"
    | "context-dependent";
  message: string;
  candidates: string[];
}

export interface EchoMagicCommandGrammarSettings {
  version: typeof ECHO_MAGIC_COMMAND_GRAMMAR_VERSION;
  enabled: boolean;
  requireVerifiedSpeaker: boolean;
  locale: EchoMagicCommandLocale;
  diagnosticsEnabled: boolean;
  testingEnabled: boolean;
  languageSelectionPrepared: true;
  lastResetAt: string | null;
  lastRecognizedAt: string | null;
}

export interface EchoMagicCommandGrammarInput {
  transcript: string;
  field: {
    ambient: { currentMode: AmbientGameplayMode };
    groups: Array<{
      id: string;
      label: string;
      quantity: number;
      owner: Owner;
      controller: Owner;
      identity: { cardId: string; name: string } | null;
      characteristics: {
        supertypes: string[];
        cardTypes: string[];
        subtypes: string[];
        isLegendary: boolean;
        isCreature: boolean;
        isToken: boolean;
      };
      session?: { objectIds: string[] };
    }>;
    recentCards: Array<{ cardId: string; name: string }>;
  };
  speakerVerification: EchoSpeakerVerificationResult | null;
  settings?: EchoMagicCommandGrammarSettings;
  timestamp?: string;
}

export interface EchoMagicCommandParseInput {
  transcript: string;
  field: EchoMagicCommandGrammarInput["field"];
  timestamp?: string;
}

export interface EchoMagicCommandGrammarResult {
  version: typeof ECHO_MAGIC_COMMAND_GRAMMAR_VERSION;
  resultId: string;
  status: EchoMagicCommandStatus;
  action: EchoMagicCommandAction | null;
  intentKind: AmbientIntentKind | null;
  intent: AmbientIntentInput | null;
  originalPhrase: string;
  normalizedPhrase: string;
  interpretedPhrase: string;
  quantity: number | null;
  primaryObject: EchoMagicCommandObject | null;
  secondaryObject: EchoMagicCommandObject | null;
  targetObject: EchoMagicCommandObject | null;
  ambiguities: EchoMagicCommandAmbiguity[];
  errors: string[];
  confidence: AmbientConfidenceAssessment;
  requiredMode: AmbientGameplayMode | null;
  speakerVerification: {
    required: boolean;
    accepted: boolean;
    decision: EchoSpeakerVerificationResult["decision"] | null;
    score: number | null;
  };
  recovery: {
    correctionTypes: AmbientCorrectionType[];
    message: string | null;
  };
  accessibilityAnnouncement: string;
  diagnostics: {
    locale: EchoMagicCommandLocale;
    grammarEnabled: boolean;
    parserVersion: typeof ECHO_MAGIC_COMMAND_GRAMMAR_VERSION;
    directBattlefieldMutation: false;
  };
}

export interface EchoMagicCommandGrammarDiagnostics {
  version: typeof ECHO_MAGIC_COMMAND_GRAMMAR_VERSION;
  enabled: boolean;
  requireVerifiedSpeaker: boolean;
  locale: EchoMagicCommandLocale;
  lastRecognizedAt: string | null;
  lastStatus: EchoMagicCommandStatus | null;
  lastIntentKind: AmbientIntentKind | null;
  lastError: string | null;
  recognizedCount: number;
  directBattlefieldMutation: false;
}
