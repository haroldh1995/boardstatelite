import type { EchoAudioSampleMetrics } from "./listeningTypes";

export const ECHO_VOICE_ENROLLMENT_VERSION = 1;
export const ECHO_SPEAKER_PROFILE_VERSION = 1;

export type EchoEnrollmentVolume =
  | "quiet"
  | "normal"
  | "loud"
  | "acrossTable"
  | "excited";

export type EchoEnrollmentStatus =
  | "notStarted"
  | "enrolling"
  | "complete"
  | "needsRecalibration";

export type EchoEnrollmentSessionStatus =
  | "idle"
  | "active"
  | "recording"
  | "sampleAccepted"
  | "sampleRejected"
  | "complete"
  | "cancelled"
  | "failed";

export type EchoEnrollmentSampleStatus = "accepted" | "rejected";

export type EchoRecordingQualityIssue =
  | "background-noise"
  | "clipping"
  | "low-volume"
  | "silence"
  | "microphone-failure"
  | "too-short"
  | "corrupted-audio";

export type EchoCalibrationEnvironment =
  | "home"
  | "localGameStore"
  | "tournament"
  | "quietRoom"
  | "custom";

export type EchoMicrophonePosition =
  | "phoneInHand"
  | "phoneOnTable"
  | "besidePlaymat"
  | "chargingStand"
  | "custom";

export interface EchoEnrollmentPhrase {
  id: string;
  text: string;
  volume: EchoEnrollmentVolume;
  focus: "land" | "phase" | "turn" | "token" | "combat";
}

export interface EchoRecordingQuality {
  accepted: boolean;
  score: number;
  issues: EchoRecordingQualityIssue[];
  durationMs: number;
  rmsDb: number;
  peakDb: number;
  noiseFloorDb: number;
  clippingRatio: number;
}

export interface EchoAcousticFeatureVector {
  rmsDb: number;
  peakDb: number;
  noiseFloorDb: number;
  dynamicRangeDb: number;
  zeroCrossingRate: number;
  spectralCentroidHz: number;
  sampleRate: number | null;
  channelCount: number | null;
  fingerprint: string;
}

export interface EchoVoiceSample {
  id: string;
  phraseId: string;
  phrase: string;
  volume: EchoEnrollmentVolume;
  capturedAt: string;
  status: EchoEnrollmentSampleStatus;
  quality: EchoRecordingQuality;
  features: EchoAcousticFeatureVector;
  deviceId: string | null;
  deviceLabel: string | null;
  devicePosition: EchoMicrophonePosition;
  environment: EchoCalibrationEnvironment;
  rawAudioRetained: false;
}

export interface EchoEnvironmentCalibrationProfile {
  id: string;
  label: string;
  environment: EchoCalibrationEnvironment;
  devicePosition: EchoMicrophonePosition;
  createdAt: string;
  updatedAt: string;
  sampleCount: number;
  noiseFloorDb: number;
  peakNoiseDb: number;
  recommendedConfidenceAdjustment: number;
  rawAudioRetained: false;
}

export interface EchoSpeakerProfile {
  version: typeof ECHO_SPEAKER_PROFILE_VERSION;
  profileId: string | null;
  status: EchoEnrollmentStatus;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  samples: EchoVoiceSample[];
  requiredPhraseIds: string[];
  requiredVolumes: EchoEnrollmentVolume[];
  calibrationProfiles: EchoEnvironmentCalibrationProfile[];
  activeCalibrationId: string | null;
  deviceCompatibility: {
    sampleRate: number | null;
    channelCount: number | null;
    deviceLabels: string[];
    positions: EchoMicrophonePosition[];
  };
  acousticModel: {
    sampleCount: number;
    volumeCoverage: EchoEnrollmentVolume[];
    averageRmsDb: number | null;
    averageNoiseFloorDb: number | null;
    centroidHz: number | null;
    fingerprintHash: string | null;
  };
  privacy: {
    rawAudioRetained: false;
    storedData: "acoustic-features-only" | "none" | "calibration-features-only";
    cloudUploadEnabled: false;
  };
}

export interface EchoVoiceEnrollmentSession {
  version: typeof ECHO_VOICE_ENROLLMENT_VERSION;
  status: EchoEnrollmentSessionStatus;
  mode: "new" | "replace" | "additional" | "recalibration";
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  currentStepIndex: number;
  acceptedSampleIds: string[];
  rejectedAttempts: number;
  lastQuality: EchoRecordingQuality | null;
  lastError: string | null;
  currentEnvironment: EchoCalibrationEnvironment;
  currentDevicePosition: EchoMicrophonePosition;
  alternativePacing: boolean;
}

export interface EchoVoiceEnrollmentSettings {
  version: typeof ECHO_VOICE_ENROLLMENT_VERSION;
  profile: EchoSpeakerProfile;
  session: EchoVoiceEnrollmentSession;
  phrases: EchoEnrollmentPhrase[];
}

export interface EchoVoiceEnrollmentResult {
  settings: EchoVoiceEnrollmentSettings;
  accepted: boolean;
  completed: boolean;
  sample: EchoVoiceSample | null;
  quality: EchoRecordingQuality;
  message: string;
}

export interface EchoEnvironmentCalibrationInput {
  label?: string;
  environment: EchoCalibrationEnvironment;
  devicePosition: EchoMicrophonePosition;
  metrics: EchoAudioSampleMetrics;
}
