import type { CardIdentity, FieldState, Owner, Zone } from "../domain/types";
import type { AmbientConfidenceLevel } from "./ambientConfidenceTypes";
import type {
  AmbientEntityReference,
  AmbientIntentKind,
} from "./ambientEventTypes";
import type { EchoDeckSnapshotCard } from "./entityResolutionTypes";
import type {
  EchoSpeakerVerificationDecision,
  EchoSpeakerVerificationResult,
} from "./speakerVerificationTypes";

export const ECHO_PRONUNCIATION_LEARNING_VERSION = 1;

export type EchoPronunciationLearningSensitivity =
  | "conservative"
  | "balanced"
  | "adaptive";

export type EchoPronunciationVocabularyScope =
  | "personal"
  | "playgroup"
  | "deck"
  | "player";

export type EchoPronunciationLearningStatus =
  | "candidate"
  | "active"
  | "disabled";

export type EchoPronunciationLearningSignalSource =
  | "successful-recognition"
  | "manual-correction"
  | "clarification-response"
  | "accepted-confirmation"
  | "confirmed-gameplay";

export type EchoPronunciationLearningOutcome =
  | "accepted"
  | "rejected"
  | "corrected";

export interface EchoPronunciationLearningSettings {
  version: typeof ECHO_PRONUNCIATION_LEARNING_VERSION;
  enabled: boolean;
  automaticLearning: boolean;
  learningSensitivity: EchoPronunciationLearningSensitivity;
  minimumConfirmations: number;
  maxVocabularyEntries: number;
  confidenceBoostLimit: number;
  importExportPrepared: true;
  privacyControlsPrepared: true;
  localizationReady: true;
  rawAudioRetained: false;
  localOnly: true;
  lastResetAt: string | null;
}

export interface EchoPronunciationCanonicalEntity {
  kind:
    | "card"
    | "battlefield-object"
    | "commander"
    | "token"
    | "player"
    | "opponent"
    | "counter"
    | "zone"
    | "phrase";
  label: string;
  normalizedLabel: string;
  cardId: string | null;
  groupId: string | null;
  objectIds: string[];
  owner: Owner | null;
  zone: Zone | null;
  entity: AmbientEntityReference | null;
  source: "canonical-card" | "battlefield" | "player-alias" | "user-vocabulary";
}

export interface EchoPronunciationVocabularyEntry {
  version: typeof ECHO_PRONUNCIATION_LEARNING_VERSION;
  id: string;
  scope: EchoPronunciationVocabularyScope;
  phrase: string;
  normalizedPhrase: string;
  aliases: string[];
  canonical: EchoPronunciationCanonicalEntity;
  status: EchoPronunciationLearningStatus;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  observationCount: number;
  successfulConfirmationCount: number;
  manualCorrectionCount: number;
  rejectedCount: number;
  confidenceBoost: number;
  learnedFrom:
    | "user"
    | "repeated-confirmation"
    | "clarification"
    | "manual-correction"
    | "deck-context";
  deckContextId: string | null;
  playgroupId: string | null;
  speakerDecision: EchoSpeakerVerificationDecision | null;
  rawAudioRetained: false;
  userEditable: true;
}

export interface EchoPronunciationPlayerAlias {
  id: string;
  alias: string;
  normalizedAlias: string;
  playerId: string | null;
  displayName: string;
  owner: Owner;
  createdAt: string;
  updatedAt: string;
  successfulUseCount: number;
  userEditable: true;
}

export interface EchoPronunciationLearningSignal {
  phrase: string;
  canonical: EchoPronunciationCanonicalEntity;
  source: EchoPronunciationLearningSignalSource;
  outcome: EchoPronunciationLearningOutcome;
  speakerVerification: EchoSpeakerVerificationResult | null;
  entityConfidence: AmbientConfidenceLevel | null;
  intentKind: AmbientIntentKind | null;
  deckSnapshot?: EchoDeckSnapshotCard[];
  deckContextId?: string | null;
  playgroupId?: string | null;
  timestamp?: string;
}

export interface EchoPronunciationLearningDecision {
  version: typeof ECHO_PRONUNCIATION_LEARNING_VERSION;
  action:
    | "ignored"
    | "observed"
    | "candidate-updated"
    | "activated"
    | "rejected"
    | "reset";
  entryId: string | null;
  reason: string;
  confidenceBoost: number;
  requiredConfirmations: number;
  directBattlefieldMutation: false;
}

export interface EchoPronunciationLearningDiagnostics {
  version: typeof ECHO_PRONUNCIATION_LEARNING_VERSION;
  activeEntryCount: number;
  candidateEntryCount: number;
  playerAliasCount: number;
  deckVocabularyCount: number;
  playgroupVocabularyCount: number;
  lastLearnedAt: string | null;
  lastAppliedAt: string | null;
  lastResetAt: string | null;
  lastDecision: EchoPronunciationLearningDecision["action"] | null;
  lastReason: string | null;
  localOnly: true;
  rawAudioRetained: false;
  directBattlefieldMutation: false;
}

export interface EchoPronunciationLearningState {
  version: typeof ECHO_PRONUNCIATION_LEARNING_VERSION;
  entries: EchoPronunciationVocabularyEntry[];
  playerAliases: EchoPronunciationPlayerAlias[];
  playgroupVocabulary: EchoPronunciationVocabularyEntry[];
  deckVocabulary: EchoPronunciationVocabularyEntry[];
  diagnostics: EchoPronunciationLearningDiagnostics;
}

export interface EchoPronunciationAdaptationInput {
  field: FieldState;
  text: string;
  candidates: Array<{
    id: string;
    label: string;
    groupId: string | null;
    cardId: string | null;
    owner: Owner | null;
    zone: Zone | null;
  }>;
  deckSnapshot?: CardIdentity[] | EchoDeckSnapshotCard[];
  timestamp?: string;
}
