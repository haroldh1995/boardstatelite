import type { AmbientConfidenceAssessment } from "./ambientConfidenceTypes";
import type { EchoAudioSampleMetrics } from "./listeningTypes";
import type {
  EchoAcousticFeatureVector,
  EchoCalibrationEnvironment,
  EchoMicrophonePosition,
  EchoSpeakerProfile,
} from "./voiceEnrollmentTypes";

export const ECHO_SPEAKER_VERIFICATION_VERSION = 1;

export type EchoSpeakerVerificationLifecycleStatus =
  | "idle"
  | "initializing"
  | "verifying"
  | "verified"
  | "rejected"
  | "paused"
  | "interrupted"
  | "recovering"
  | "stopped"
  | "failed";

export type EchoSpeakerVerificationTransitionReason =
  | "initialization"
  | "verification-requested"
  | "verification-started"
  | "verified-user"
  | "unknown-speaker"
  | "low-confidence-match"
  | "no-match"
  | "missing-profile"
  | "corrupted-profile"
  | "microphone-interruption"
  | "audio-loss"
  | "calibration-mismatch"
  | "multiple-speakers-suspected"
  | "manual-pause"
  | "manual-stop"
  | "recovery"
  | "reset";

export type EchoSpeakerVerificationDecision =
  | "verifiedUser"
  | "unknownSpeaker"
  | "lowConfidenceMatch"
  | "noMatch";

export type EchoSpeakerVerificationSensitivity =
  | "commanderStrict"
  | "balanced"
  | "lenient";

export type EchoSpeakerVerificationStageName =
  | "incoming-audio"
  | "voice-activity-detection"
  | "audio-cleanup"
  | "speaker-feature-extraction"
  | "speaker-profile-comparison"
  | "similarity-scoring"
  | "confidence-assignment"
  | "verification-decision"
  | "result-publication";

export type EchoSpeakerVerificationStageStatus =
  | "pending"
  | "passed"
  | "failed"
  | "skipped";

export type EchoMultiSpeakerRisk = "none" | "possible" | "likely";

export type EchoSpeakerVerificationRecoveryAction =
  | "retry"
  | "speak-again"
  | "manual-override"
  | "temporary-ignore";

export interface EchoSpeakerVerificationStageRecord {
  stage: EchoSpeakerVerificationStageName;
  status: EchoSpeakerVerificationStageStatus;
  message: string;
  timestamp: string;
}

export interface EchoSpeakerVerificationThresholds {
  verified: number;
  lowConfidence: number;
  rejectionFloor: number;
}

export interface EchoSpeakerVerificationComparison {
  profileId: string | null;
  sampleCount: number;
  comparedSampleIds: string[];
  bestSampleScore: number | null;
  averageTopScore: number | null;
  modelScore: number | null;
  calibrationAdjustment: number;
  environmentAdjustment: number;
  devicePositionAdjustment: number;
  multiSpeakerPenalty: number;
}

export interface EchoSpeakerVerificationInput {
  profile: EchoSpeakerProfile;
  metrics: EchoAudioSampleMetrics;
  environment: EchoCalibrationEnvironment;
  devicePosition: EchoMicrophonePosition;
  ambientMode?: string | null;
  sensitivity: EchoSpeakerVerificationSensitivity;
  timestamp?: string;
}

export interface EchoSpeakerVerificationResult {
  version: typeof ECHO_SPEAKER_VERIFICATION_VERSION;
  attemptId: string;
  evaluatedAt: string;
  lifecycleStatus: EchoSpeakerVerificationLifecycleStatus;
  decision: EchoSpeakerVerificationDecision;
  verified: boolean;
  score: number | null;
  thresholds: EchoSpeakerVerificationThresholds;
  confidence: AmbientConfidenceAssessment;
  reasons: string[];
  recoveryActions: EchoSpeakerVerificationRecoveryAction[];
  stages: EchoSpeakerVerificationStageRecord[];
  comparison: EchoSpeakerVerificationComparison;
  incomingFeatures: EchoAcousticFeatureVector | null;
  voiceActivity: {
    detected: boolean;
    clipped: boolean;
    noisy: boolean;
    audioLoss: boolean;
  };
  environment: EchoCalibrationEnvironment;
  devicePosition: EchoMicrophonePosition;
  multiSpeakerRisk: EchoMultiSpeakerRisk;
  profileStatus: EchoSpeakerProfile["status"];
  rawAudioRetained: false;
}

export interface EchoSpeakerVerificationLifecycle {
  version: typeof ECHO_SPEAKER_VERIFICATION_VERSION;
  status: EchoSpeakerVerificationLifecycleStatus;
  previousStatus: EchoSpeakerVerificationLifecycleStatus | null;
  requestedStatus: EchoSpeakerVerificationLifecycleStatus | null;
  transitionReason: EchoSpeakerVerificationTransitionReason;
  transitionTimestamp: string;
  lastError: string | null;
  lastResult: EchoSpeakerVerificationResult | null;
  invalidTransitionCount: number;
}

export interface EchoSpeakerVerificationSettings {
  version: typeof ECHO_SPEAKER_VERIFICATION_VERSION;
  enabled: boolean;
  sensitivity: EchoSpeakerVerificationSensitivity;
  lifecycle: EchoSpeakerVerificationLifecycle;
  lastVerifiedAt: string | null;
  lastRejectedAt: string | null;
  verificationAttempts: number;
  privacy: {
    rawAudioRetained: false;
    storedData: "speaker-profile-features-only" | "none";
    cloudVerificationEnabled: false;
  };
}

export interface EchoSpeakerVerificationDiagnostics {
  version: typeof ECHO_SPEAKER_VERIFICATION_VERSION;
  status: EchoSpeakerVerificationLifecycleStatus;
  sensitivity: EchoSpeakerVerificationSensitivity;
  lastDecision: EchoSpeakerVerificationDecision | null;
  lastScore: number | null;
  multiSpeakerRisk: EchoMultiSpeakerRisk | null;
  attempts: number;
  enabled: boolean;
  rawAudioRetained: false;
}
