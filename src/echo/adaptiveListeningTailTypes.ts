import type { FieldState } from "../domain/types";
import type { AmbientGameplayMode } from "./ambientTypes";
import type { AmbientIntentInput } from "./ambientEventTypes";
import type { EchoListeningWindowKind } from "./contextualListeningTypes";
import type { EchoWindowedMagicCommandResult } from "./contextualListeningTypes";
import type { EchoMagicCommandGrammarSettings } from "./magicCommandGrammarTypes";
import type { EchoSpeakerVerificationResult } from "./speakerVerificationTypes";

export const ECHO_ADAPTIVE_LISTENING_TAIL_VERSION = 1;

export type EchoAdaptiveListeningTailStatus =
  | "idle"
  | "capturing"
  | "waitingForTail"
  | "finalizing"
  | "finalized"
  | "cancelled"
  | "interrupted"
  | "recovered"
  | "failed";

export type EchoAdaptiveListeningTailSensitivity =
  | "strict"
  | "balanced"
  | "extended";

export type EchoAdaptiveListeningFeedbackState =
  | "hidden"
  | "listening"
  | "recognizing"
  | "waitingForAdditionalInput"
  | "processing"
  | "complete"
  | "cancelled"
  | "failed";

export type EchoAdaptiveListeningFinalizationReason =
  | "natural-timeout"
  | "explicit-command"
  | "manual-cancellation"
  | "ambient-mode-transition"
  | "recovery"
  | "session-interruption"
  | "application-lifecycle"
  | "session-timeout"
  | "parser-failure";

export type EchoAdaptiveCommandBoundaryReason =
  | "grammar-completion"
  | "pause"
  | "intent-transition"
  | "window-transition"
  | "speaker-inactivity"
  | "manual-fragment";

export type EchoAdaptiveListeningSegmentStatus =
  | "recognized"
  | "duplicate"
  | "irrelevant"
  | "rejected"
  | "incomplete"
  | "unknown"
  | "failed";

export type EchoAdaptiveListeningCommandStatus =
  | "captured"
  | "duplicate"
  | "rejected"
  | "published";

export interface EchoAdaptiveListeningTailSettings {
  version: typeof ECHO_ADAPTIVE_LISTENING_TAIL_VERSION;
  enabled: boolean;
  tailDurationMs: number;
  sessionTimeoutMs: number;
  sensitivity: EchoAdaptiveListeningTailSensitivity;
  automaticFinalization: boolean;
  duplicateSuppressionEnabled: boolean;
  accessibilityAnnouncementsPrepared: true;
  adjustableTimeoutsPrepared: true;
  lastResetAt: string | null;
}

export interface EchoAdaptiveListeningTranscriptSegment {
  id: string;
  receivedAt: string;
  transcript: string;
  normalizedTranscript: string;
  status: EchoAdaptiveListeningSegmentStatus;
  boundaryReason: EchoAdaptiveCommandBoundaryReason;
  commandIds: string[];
  grammarResultId: string | null;
  windowKind: EchoListeningWindowKind | null;
  duplicate: boolean;
}

export interface EchoAdaptiveListeningCommand {
  id: string;
  order: number;
  receivedAt: string;
  transcript: string;
  normalizedTranscript: string;
  boundaryReason: EchoAdaptiveCommandBoundaryReason;
  windowedResult: EchoWindowedMagicCommandResult;
  intent: AmbientIntentInput | null;
  duplicateFingerprint: string;
  status: EchoAdaptiveListeningCommandStatus;
}

export interface EchoAdaptiveListeningFinalization {
  reason: EchoAdaptiveListeningFinalizationReason;
  finalizedAt: string;
  commandCount: number;
  publishedIntentIds: string[];
  accessibilityAnnouncement: string;
}

export interface EchoAdaptiveListeningSession {
  version: typeof ECHO_ADAPTIVE_LISTENING_TAIL_VERSION;
  id: string;
  sessionId: string | null;
  status: EchoAdaptiveListeningTailStatus;
  ambientMode: AmbientGameplayMode;
  windowId: string | null;
  windowKind: EchoListeningWindowKind | null;
  startedAt: string;
  updatedAt: string;
  lastRelevantSpeechAt: string | null;
  finalizeAfter: string | null;
  hardExpiresAt: string | null;
  transcriptSegments: EchoAdaptiveListeningTranscriptSegment[];
  commands: EchoAdaptiveListeningCommand[];
  duplicateFingerprints: string[];
  finalization: EchoAdaptiveListeningFinalization | null;
  lastError: string | null;
}

export interface EchoAdaptiveListeningTailFeedback {
  current: EchoAdaptiveListeningFeedbackState;
  label: string;
  ariaLive: "off" | "polite" | "assertive";
  updatedAt: string | null;
}

export interface EchoAdaptiveListeningTailDiagnostics {
  version: typeof ECHO_ADAPTIVE_LISTENING_TAIL_VERSION;
  activeSessionId: string | null;
  status: EchoAdaptiveListeningTailStatus;
  activeWindowKind: EchoListeningWindowKind | null;
  capturedCommandCount: number;
  duplicateSuppressionCount: number;
  lastFinalizationReason: EchoAdaptiveListeningFinalizationReason | null;
  lastError: string | null;
  tailDurationMs: number;
  sessionTimeoutMs: number;
  automaticFinalization: boolean;
  timersActive: boolean;
  directBattlefieldMutation: false;
}

export interface EchoAdaptiveListeningTailState {
  version: typeof ECHO_ADAPTIVE_LISTENING_TAIL_VERSION;
  activeSessionId: string | null;
  sessions: EchoAdaptiveListeningSession[];
  lastFinalizedSessionId: string | null;
  lastCancelledSessionId: string | null;
  duplicateSuppressionCount: number;
  feedback: EchoAdaptiveListeningTailFeedback;
  diagnostics: EchoAdaptiveListeningTailDiagnostics;
}

export interface EchoAdaptiveListeningCaptureInput {
  transcript: string;
  field: FieldState;
  speakerVerification: EchoSpeakerVerificationResult | null;
  grammarSettings?: EchoMagicCommandGrammarSettings;
  windowState?: FieldState["contextualListening"] | null;
  timestamp?: string;
  settings?: EchoAdaptiveListeningTailSettings;
}

export interface EchoAdaptiveListeningCaptureResult {
  state: EchoAdaptiveListeningTailState;
  acceptedCommands: EchoAdaptiveListeningCommand[];
  duplicateCommands: EchoAdaptiveListeningCommand[];
  rejectedSegments: EchoAdaptiveListeningTranscriptSegment[];
  finalization: EchoAdaptiveListeningFinalization | null;
}
