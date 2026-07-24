import type { AmbientGameplayMode } from "./ambientTypes";
import type {
  AmbientConfidenceAssessment,
  AmbientConfidenceLevel,
} from "./ambientConfidenceTypes";
import type { AmbientIntentKind } from "./ambientEventTypes";
import type {
  EchoMagicCommandGrammarInput,
  EchoMagicCommandGrammarResult,
  EchoMagicCommandObjectKind,
} from "./magicCommandGrammarTypes";

export const ECHO_CONTEXTUAL_LISTENING_VERSION = 1;

export const ECHO_LISTENING_WINDOW_KINDS = [
  "generalGameplay",
  "landPlay",
  "spellCasting",
  "activatedAbility",
  "triggerResolution",
  "counterModification",
  "tokenCreation",
  "tokenRemoval",
  "lifeAdjustment",
  "commanderDamage",
  "combatPreparation",
  "combatDeclaration",
  "combatResolution",
  "endStep",
  "endTurn",
] as const;

export type EchoListeningWindowKind =
  (typeof ECHO_LISTENING_WINDOW_KINDS)[number];

export type EchoListeningWindowLifecycleStatus =
  | "created"
  | "activated"
  | "updated"
  | "suspended"
  | "resumed"
  | "expired"
  | "cancelled"
  | "completed"
  | "recovered"
  | "destroyed";

export type EchoListeningWindowActivationSource =
  | "ambient-mode"
  | "phase"
  | "planner"
  | "action-strip"
  | "explicit-command"
  | "recovery"
  | "session-restoration"
  | "system";

export interface EchoListeningWindowLifecycleRecord {
  status: EchoListeningWindowLifecycleStatus;
  timestamp: string;
  reason: string;
}

export interface EchoListeningWindowVocabulary {
  verbs: string[];
  nouns: string[];
  counterNames: string[];
  tokenTypes: string[];
  zones: string[];
  manaColors: string[];
  intentKinds: AmbientIntentKind[];
}

export interface EchoListeningWindowEntityPriority {
  kind: EchoMagicCommandObjectKind;
  weight: number;
  reason: string;
}

export interface EchoContextualEntityPrioritySignal {
  entityId: string;
  label: string;
  kind: EchoMagicCommandObjectKind;
  weight: number;
  reason: string;
}

export interface EchoListeningWindow {
  version: typeof ECHO_CONTEXTUAL_LISTENING_VERSION;
  id: string;
  kind: EchoListeningWindowKind;
  status: EchoListeningWindowLifecycleStatus;
  source: EchoListeningWindowActivationSource;
  parentId: string | null;
  depth: number;
  ambientMode: AmbientGameplayMode;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  vocabulary: EchoListeningWindowVocabulary;
  entityPriorities: EchoListeningWindowEntityPriority[];
  allowedIntentKinds: AmbientIntentKind[];
  expectedActions: string[];
  accessibilityLabel: string;
  lifecycle: EchoListeningWindowLifecycleRecord[];
}

export interface EchoContextualListeningSettings {
  version: typeof ECHO_CONTEXTUAL_LISTENING_VERSION;
  enabled: boolean;
  defaultTimeoutMs: number;
  preserveWindowStackOnRestore: boolean;
  accessibilityAnnouncementsPrepared: true;
  localizationReady: true;
  lastResetAt: string | null;
}

export interface EchoContextualListeningDiagnostics {
  version: typeof ECHO_CONTEXTUAL_LISTENING_VERSION;
  sessionId: string | null;
  activeWindowId: string | null;
  activeWindowKind: EchoListeningWindowKind | null;
  activeWindowStatus: EchoListeningWindowLifecycleStatus | null;
  stackDepth: number;
  lastRecoveredWindowId: string | null;
  lastExpiredWindowId: string | null;
  lastGrammarResultId: string | null;
  lastStatus: EchoWindowedMagicCommandResult["status"] | null;
  lastError: string | null;
  windowSwitchCount: number;
  grammarConstrained: boolean;
}

export interface EchoContextualListeningState {
  version: typeof ECHO_CONTEXTUAL_LISTENING_VERSION;
  sessionId: string | null;
  activeWindowId: string | null;
  windows: EchoListeningWindow[];
  defaultTimeoutMs: number;
  maxDepth: number;
  lastRecoveredWindowId: string | null;
  lastExpiredWindowId: string | null;
  lastGrammarResultId: string | null;
  diagnostics: EchoContextualListeningDiagnostics;
}

export type EchoWindowedMagicCommandStatus =
  | "accepted"
  | "window-mismatch"
  | "ambiguous"
  | "incomplete"
  | "unknown"
  | "rejected"
  | "disabled";

export interface EchoWindowedMagicCommandInput extends EchoMagicCommandGrammarInput {
  window: EchoListeningWindow | null;
}

export interface EchoWindowedMagicCommandResult {
  version: typeof ECHO_CONTEXTUAL_LISTENING_VERSION;
  status: EchoWindowedMagicCommandStatus;
  windowId: string | null;
  windowKind: EchoListeningWindowKind | null;
  grammar: EchoMagicCommandGrammarResult;
  accepted: boolean;
  confidence: AmbientConfidenceAssessment;
  confidenceAdjustment: {
    level: AmbientConfidenceLevel;
    scoreDelta: number;
    reasons: string[];
  };
  vocabulary: {
    allowedIntentKinds: AmbientIntentKind[];
    matchedIntentKind: AmbientIntentKind | null;
    restricted: boolean;
  };
  entityPrioritySignals: EchoContextualEntityPrioritySignal[];
  recovery: {
    required: boolean;
    reason: string | null;
  };
  accessibilityAnnouncement: string;
  directBattlefieldMutation: false;
}
