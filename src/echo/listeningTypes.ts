import type { AmbientGameplayMode } from "./ambientTypes";
import type { EchoSpeakerVerificationSettings } from "./speakerVerificationTypes";
import type { EchoVoiceEnrollmentSettings } from "./voiceEnrollmentTypes";

export const ECHO_LISTENING_STATE_VERSION = 1;
export const ECHO_VOICE_SETTINGS_VERSION = 1;

export type EchoListeningStatus =
  | "idle"
  | "preparing"
  | "requestingPermission"
  | "permissionGranted"
  | "permissionDenied"
  | "initializing"
  | "ready"
  | "listening"
  | "temporarilyPaused"
  | "interrupted"
  | "recovering"
  | "stopping"
  | "stopped"
  | "failed";

export type EchoListeningPermissionStatus =
  | "unknown"
  | "unsupported"
  | "prompt"
  | "granted"
  | "denied"
  | "permanentlyDenied";

export type EchoMicrophoneAvailability =
  | "unknown"
  | "available"
  | "unavailable"
  | "unsupported";

export type EchoAudioSessionInterruption =
  | "app-backgrounded"
  | "app-foregrounded"
  | "audio-device-changed"
  | "microphone-lost"
  | "system-interruption"
  | "permission-revoked"
  | "manual-stop"
  | "test-complete"
  | "unknown";

export type EchoListeningTransitionReason =
  | "initialization"
  | "availability-refresh"
  | "permission-request"
  | "permission-granted"
  | "permission-denied"
  | "permission-revoked"
  | "audio-initialization"
  | "audio-ready"
  | "listening-started"
  | "temporary-pause"
  | "interruption"
  | "recovery"
  | "manual-stop"
  | "session-stopped"
  | "failure"
  | "settings-updated"
  | "ambient-mode-changed"
  | "reset";

export type EchoListeningIndicator =
  | "hidden"
  | "unavailable"
  | "permission-needed"
  | "ready"
  | "listening"
  | "paused"
  | "recovering"
  | "failed";

export interface EchoVoiceSettings {
  version: typeof ECHO_VOICE_SETTINGS_VERSION;
  voiceFeaturesEnabled: boolean;
  ambientListeningEnabled: boolean;
  pushToTalkEnabled: boolean;
  alwaysListeningEnabled: boolean;
  microphoneTestEnabled: boolean;
  permissionPrimed: boolean;
  privacyAcknowledged: boolean;
  lastResetAt: string | null;
  enrollment: EchoVoiceEnrollmentSettings;
  verification: EchoSpeakerVerificationSettings;
}

export interface EchoAudioSessionState {
  sessionId: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  sampleRate: number | null;
  channelCount: number | null;
  bufferMilliseconds: number;
  activeDeviceId: string | null;
  activeDeviceLabel: string | null;
  rawAudioRetained: false;
}

export type EchoAudioSamplePurpose =
  | "microphone-test"
  | "voice-enrollment"
  | "environment-calibration"
  | "speaker-verification";

export interface EchoAudioSampleRequest {
  purpose: EchoAudioSamplePurpose;
  durationMs: number;
}

export interface EchoAudioSampleMetrics {
  capturedAt: string;
  durationMs: number;
  sampleRate: number | null;
  channelCount: number | null;
  activeDeviceId: string | null;
  activeDeviceLabel: string | null;
  rmsDb: number;
  peakDb: number;
  noiseFloorDb: number;
  dynamicRangeDb: number;
  clippingRatio: number;
  zeroCrossingRate: number;
  spectralCentroidHz: number;
  corrupted: boolean;
  rawAudioRetained: false;
}

export interface EchoListeningTransitionRecord {
  from: EchoListeningStatus;
  to: EchoListeningStatus;
  reason: EchoListeningTransitionReason;
  requestedAt: string;
  accepted: boolean;
  message: string;
}

export interface EchoListeningPrivacyState {
  explicitOptInRequired: true;
  cloudTranscriptionEnabled: false;
  continuousConversationRecording: false;
  rawAudioRetention: "none";
  localProcessingPreferred: true;
  activeIndicatorRequired: true;
}

export interface EchoListeningState {
  version: typeof ECHO_LISTENING_STATE_VERSION;
  status: EchoListeningStatus;
  previousStatus: EchoListeningStatus | null;
  requestedStatus: EchoListeningStatus | null;
  permission: EchoListeningPermissionStatus;
  availability: EchoMicrophoneAvailability;
  indicator: EchoListeningIndicator;
  ambientMode: AmbientGameplayMode;
  transitionReason: EchoListeningTransitionReason;
  transitionTimestamp: string;
  lastTransition: EchoListeningTransitionRecord | null;
  invalidTransitionCount: number;
  lastError: string | null;
  lastInterruption: EchoAudioSessionInterruption | null;
  activeSession: EchoAudioSessionState;
  privacy: EchoListeningPrivacyState;
}

export interface EchoListeningDiagnostics {
  version: typeof ECHO_LISTENING_STATE_VERSION;
  status: EchoListeningStatus;
  previousStatus: EchoListeningStatus | null;
  permission: EchoListeningPermissionStatus;
  availability: EchoMicrophoneAvailability;
  indicator: EchoListeningIndicator;
  ambientMode: AmbientGameplayMode;
  activeSessionId: string | null;
  invalidTransitionCount: number;
  lastError: string | null;
  lastInterruption: EchoAudioSessionInterruption | null;
  listenerCount: number;
  hasActiveStream: boolean;
  rawAudioRetained: false;
}

export interface EchoListeningSnapshot {
  status: EchoListeningStatus;
  permission: EchoListeningPermissionStatus;
  availability: EchoMicrophoneAvailability;
  indicator: EchoListeningIndicator;
  ambientMode: AmbientGameplayMode;
  settings: EchoVoiceSettings;
}
