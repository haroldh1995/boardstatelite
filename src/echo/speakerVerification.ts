import { makeId } from "../domain/cards";
import { normalizeAmbientConfidence } from "./ambientConfidence";
import type { AmbientConfidenceLevel } from "./ambientConfidenceTypes";
import type { EchoAudioSampleMetrics } from "./listeningTypes";
import {
  createAcousticFeatureVector,
  normalizeVoiceEnrollmentSettings,
} from "./voiceEnrollment";
import {
  ECHO_SPEAKER_VERIFICATION_VERSION,
  type EchoMultiSpeakerRisk,
  type EchoSpeakerVerificationComparison,
  type EchoSpeakerVerificationDecision,
  type EchoSpeakerVerificationDiagnostics,
  type EchoSpeakerVerificationInput,
  type EchoSpeakerVerificationLifecycle,
  type EchoSpeakerVerificationLifecycleStatus,
  type EchoSpeakerVerificationRecoveryAction,
  type EchoSpeakerVerificationResult,
  type EchoSpeakerVerificationSensitivity,
  type EchoSpeakerVerificationSettings,
  type EchoSpeakerVerificationStageName,
  type EchoSpeakerVerificationStageRecord,
  type EchoSpeakerVerificationStageStatus,
  type EchoSpeakerVerificationThresholds,
  type EchoSpeakerVerificationTransitionReason,
} from "./speakerVerificationTypes";
import type {
  EchoAcousticFeatureVector,
  EchoCalibrationEnvironment,
  EchoMicrophonePosition,
  EchoSpeakerProfile,
} from "./voiceEnrollmentTypes";

const STAGE_ORDER: EchoSpeakerVerificationStageName[] = [
  "incoming-audio",
  "voice-activity-detection",
  "audio-cleanup",
  "speaker-feature-extraction",
  "speaker-profile-comparison",
  "similarity-scoring",
  "confidence-assignment",
  "verification-decision",
  "result-publication",
];

const VALID_LIFECYCLE_TRANSITIONS: Record<
  EchoSpeakerVerificationLifecycleStatus,
  EchoSpeakerVerificationLifecycleStatus[]
> = {
  idle: ["initializing", "verifying", "paused", "stopped", "failed"],
  initializing: [
    "verifying",
    "verified",
    "rejected",
    "interrupted",
    "stopped",
    "failed",
  ],
  verifying: ["verified", "rejected", "interrupted", "stopped", "failed"],
  verified: ["verifying", "paused", "stopped", "idle"],
  rejected: ["verifying", "recovering", "stopped", "idle"],
  paused: ["verifying", "recovering", "stopped", "idle"],
  interrupted: ["recovering", "stopped", "failed"],
  recovering: ["verifying", "idle", "stopped", "failed"],
  stopped: ["idle", "initializing", "verifying"],
  failed: ["recovering", "stopped", "idle"],
};

export function createDefaultSpeakerVerificationSettings(
  timestamp: string | null = null,
): EchoSpeakerVerificationSettings {
  return {
    version: ECHO_SPEAKER_VERIFICATION_VERSION,
    enabled: false,
    sensitivity: "commanderStrict",
    lifecycle: createDefaultVerificationLifecycle(timestamp),
    lastVerifiedAt: null,
    lastRejectedAt: null,
    verificationAttempts: 0,
    privacy: createVerificationPrivacyState("none"),
  };
}

export function normalizeSpeakerVerificationSettings(
  value: unknown,
  timestamp: string | null = null,
): EchoSpeakerVerificationSettings {
  const defaults = createDefaultSpeakerVerificationSettings(timestamp);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoSpeakerVerificationSettings>;
  return {
    ...defaults,
    enabled: Boolean(candidate.enabled),
    sensitivity: normalizeSensitivity(candidate.sensitivity),
    lifecycle: normalizeVerificationLifecycle(candidate.lifecycle, timestamp),
    lastVerifiedAt:
      typeof candidate.lastVerifiedAt === "string"
        ? candidate.lastVerifiedAt
        : null,
    lastRejectedAt:
      typeof candidate.lastRejectedAt === "string"
        ? candidate.lastRejectedAt
        : null,
    verificationAttempts: normalizeCount(candidate.verificationAttempts),
    privacy: createVerificationPrivacyState(
      candidate.privacy?.storedData === "speaker-profile-features-only"
        ? "speaker-profile-features-only"
        : "none",
    ),
  };
}

export function verifySpeaker(
  input: EchoSpeakerVerificationInput,
): EchoSpeakerVerificationResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const stages: EchoSpeakerVerificationStageRecord[] = [];
  const thresholds = thresholdsForSensitivity(input.sensitivity);
  const normalizedProfile = normalizeVoiceEnrollmentSettings({
    profile: input.profile,
  }).profile;

  recordStage(
    stages,
    "incoming-audio",
    input.metrics.rawAudioRetained ? "failed" : "passed",
    input.metrics.rawAudioRetained
      ? "Incoming audio attempted raw retention."
      : "Incoming audio metrics received without retaining raw audio.",
    timestamp,
  );

  const voiceActivity = detectVoiceActivity(input.metrics);
  recordStage(
    stages,
    "voice-activity-detection",
    voiceActivity.detected ? "passed" : "failed",
    voiceActivity.detected
      ? "Voice activity detected."
      : "No usable voice activity detected.",
    timestamp,
  );

  if (!voiceActivity.detected) {
    return createVerificationResult({
      input,
      profile: normalizedProfile,
      timestamp,
      stages,
      thresholds,
      decision: voiceActivity.audioLoss ? "unknownSpeaker" : "noMatch",
      score: null,
      level: voiceActivity.audioLoss ? "unknown" : "low",
      reasons: voiceActivityReasons(voiceActivity),
      recoveryActions: ["retry", "speak-again"],
      comparison: createEmptyComparison(normalizedProfile),
      incomingFeatures: null,
      voiceActivity,
      multiSpeakerRisk: "none",
      lifecycleStatus: "rejected",
    });
  }

  recordStage(
    stages,
    "audio-cleanup",
    "passed",
    "Audio cleanup metrics normalized for local verification.",
    timestamp,
  );
  const incomingFeatures = createAcousticFeatureVector(input.metrics);
  recordStage(
    stages,
    "speaker-feature-extraction",
    "passed",
    "Speaker feature vector extracted from privacy-safe metrics.",
    timestamp,
  );

  const profileCheck = validateProfile(normalizedProfile);
  recordStage(
    stages,
    "speaker-profile-comparison",
    profileCheck.ok ? "passed" : "failed",
    profileCheck.message,
    timestamp,
  );
  if (!profileCheck.ok) {
    return createVerificationResult({
      input,
      profile: normalizedProfile,
      timestamp,
      stages,
      thresholds,
      decision: "unknownSpeaker",
      score: null,
      level: "unknown",
      reasons: [profileCheck.message],
      recoveryActions:
        normalizedProfile.samples.length === 0 ? ["retry"] : ["speak-again"],
      comparison: createEmptyComparison(normalizedProfile),
      incomingFeatures,
      voiceActivity,
      multiSpeakerRisk: "none",
      lifecycleStatus: "failed",
    });
  }

  const comparison = compareAgainstProfile({
    profile: normalizedProfile,
    features: incomingFeatures,
    metrics: input.metrics,
    environment: input.environment,
    devicePosition: input.devicePosition,
  });
  const score = roundScore(
    Math.max(
      0,
      Math.min(
        1,
        (comparison.bestSampleScore ?? 0) * 0.52 +
          (comparison.averageTopScore ?? 0) * 0.28 +
          (comparison.modelScore ?? 0) * 0.2 +
          comparison.calibrationAdjustment +
          comparison.environmentAdjustment +
          comparison.devicePositionAdjustment -
          comparison.multiSpeakerPenalty,
      ),
    ),
  );
  recordStage(
    stages,
    "similarity-scoring",
    "passed",
    `Speaker similarity scored at ${score}.`,
    timestamp,
  );

  const multiSpeakerRisk = assessMultiSpeakerRisk({
    metrics: input.metrics,
    profile: normalizedProfile,
    score,
    environment: input.environment,
  });
  const decision = decideSpeakerVerification({
    score,
    thresholds,
    multiSpeakerRisk,
    voiceActivity,
  });
  const level = confidenceLevelForDecision(decision, score, thresholds);
  recordStage(
    stages,
    "confidence-assignment",
    "passed",
    `Speaker confidence assigned as ${level}.`,
    timestamp,
  );
  recordStage(
    stages,
    "verification-decision",
    decision === "verifiedUser" ? "passed" : "failed",
    decisionReason(decision, multiSpeakerRisk),
    timestamp,
  );

  return createVerificationResult({
    input,
    profile: normalizedProfile,
    timestamp,
    stages,
    thresholds,
    decision,
    score,
    level,
    reasons: resultReasons(decision, score, multiSpeakerRisk, comparison),
    recoveryActions: recoveryActionsForDecision(decision),
    comparison,
    incomingFeatures,
    voiceActivity,
    multiSpeakerRisk,
    lifecycleStatus: decision === "verifiedUser" ? "verified" : "rejected",
  });
}

export function applySpeakerVerificationResult(
  value: EchoSpeakerVerificationSettings,
  result: EchoSpeakerVerificationResult,
): EchoSpeakerVerificationSettings {
  const settings = normalizeSpeakerVerificationSettings(value);
  return {
    ...settings,
    enabled: true,
    lifecycle: {
      ...settings.lifecycle,
      status: result.lifecycleStatus,
      previousStatus: settings.lifecycle.status,
      requestedStatus: result.lifecycleStatus,
      transitionReason: transitionReasonForResult(result),
      transitionTimestamp: result.evaluatedAt,
      lastError: result.verified ? null : (result.reasons[0] ?? null),
      lastResult: result,
    },
    lastVerifiedAt: result.verified
      ? result.evaluatedAt
      : settings.lastVerifiedAt,
    lastRejectedAt: result.verified
      ? settings.lastRejectedAt
      : result.evaluatedAt,
    verificationAttempts: settings.verificationAttempts + 1,
    privacy: createVerificationPrivacyState("speaker-profile-features-only"),
  };
}

export function resetSpeakerVerificationSettings(
  value: EchoSpeakerVerificationSettings,
  timestamp = new Date().toISOString(),
): EchoSpeakerVerificationSettings {
  const settings = normalizeSpeakerVerificationSettings(value, timestamp);
  return {
    ...createDefaultSpeakerVerificationSettings(timestamp),
    enabled: settings.enabled,
    sensitivity: settings.sensitivity,
  };
}

export function transitionSpeakerVerificationLifecycle(
  lifecycle: EchoSpeakerVerificationLifecycle,
  targetStatus: EchoSpeakerVerificationLifecycleStatus,
  options: {
    reason: EchoSpeakerVerificationTransitionReason;
    timestamp?: string;
    result?: EchoSpeakerVerificationResult | null;
    error?: string | null;
  },
): EchoSpeakerVerificationLifecycle {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const normalized = normalizeVerificationLifecycle(lifecycle, timestamp);
  const accepted = isSpeakerVerificationTransitionAllowed(
    normalized.status,
    targetStatus,
  );
  if (!accepted) {
    return {
      ...normalized,
      requestedStatus: targetStatus,
      transitionReason: options.reason,
      transitionTimestamp: timestamp,
      invalidTransitionCount: normalized.invalidTransitionCount + 1,
      lastError:
        options.error ??
        `Invalid speaker verification transition from ${normalized.status} to ${targetStatus}.`,
    };
  }
  return {
    ...normalized,
    status: targetStatus,
    previousStatus: normalized.status,
    requestedStatus: targetStatus,
    transitionReason: options.reason,
    transitionTimestamp: timestamp,
    lastResult:
      options.result === undefined ? normalized.lastResult : options.result,
    lastError: options.error ?? null,
  };
}

export function isSpeakerVerificationTransitionAllowed(
  from: EchoSpeakerVerificationLifecycleStatus,
  to: EchoSpeakerVerificationLifecycleStatus,
): boolean {
  return from === to || VALID_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function getSpeakerVerificationDiagnostics(
  settings: EchoSpeakerVerificationSettings,
): EchoSpeakerVerificationDiagnostics {
  const normalized = normalizeSpeakerVerificationSettings(settings);
  return {
    version: ECHO_SPEAKER_VERIFICATION_VERSION,
    status: normalized.lifecycle.status,
    sensitivity: normalized.sensitivity,
    lastDecision: normalized.lifecycle.lastResult?.decision ?? null,
    lastScore: normalized.lifecycle.lastResult?.score ?? null,
    multiSpeakerRisk: normalized.lifecycle.lastResult?.multiSpeakerRisk ?? null,
    attempts: normalized.verificationAttempts,
    enabled: normalized.enabled,
    rawAudioRetained: false,
  };
}

export class EchoSpeakerVerificationEngine {
  private settings: EchoSpeakerVerificationSettings;

  constructor(settings: unknown = undefined) {
    this.settings = normalizeSpeakerVerificationSettings(settings);
  }

  hydrate(settings: unknown): EchoSpeakerVerificationSettings {
    this.settings = normalizeSpeakerVerificationSettings(settings);
    return this.getSettings();
  }

  getSettings(): EchoSpeakerVerificationSettings {
    return structuredClone(this.settings);
  }

  verify(input: EchoSpeakerVerificationInput): EchoSpeakerVerificationResult {
    this.settings = {
      ...this.settings,
      lifecycle: transitionSpeakerVerificationLifecycle(
        this.settings.lifecycle,
        "verifying",
        {
          reason: "verification-started",
          timestamp: input.timestamp,
        },
      ),
    };
    const result = verifySpeaker(input);
    this.settings = applySpeakerVerificationResult(this.settings, result);
    return result;
  }

  pause(timestamp = new Date().toISOString()): EchoSpeakerVerificationSettings {
    this.settings = {
      ...this.settings,
      lifecycle: transitionSpeakerVerificationLifecycle(
        this.settings.lifecycle,
        "paused",
        {
          reason: "manual-pause",
          timestamp,
        },
      ),
    };
    return this.getSettings();
  }

  recover(
    timestamp = new Date().toISOString(),
  ): EchoSpeakerVerificationSettings {
    this.settings = {
      ...this.settings,
      lifecycle: transitionSpeakerVerificationLifecycle(
        this.settings.lifecycle,
        "recovering",
        {
          reason: "recovery",
          timestamp,
        },
      ),
    };
    return this.getSettings();
  }

  stop(timestamp = new Date().toISOString()): EchoSpeakerVerificationSettings {
    this.settings = {
      ...this.settings,
      lifecycle: transitionSpeakerVerificationLifecycle(
        this.settings.lifecycle,
        "stopped",
        {
          reason: "manual-stop",
          timestamp,
        },
      ),
    };
    return this.getSettings();
  }

  reset(timestamp = new Date().toISOString()): EchoSpeakerVerificationSettings {
    this.settings = resetSpeakerVerificationSettings(this.settings, timestamp);
    return this.getSettings();
  }

  getDiagnostics(): EchoSpeakerVerificationDiagnostics {
    return getSpeakerVerificationDiagnostics(this.settings);
  }
}

export const echoSpeakerVerificationEngine =
  new EchoSpeakerVerificationEngine();

function createDefaultVerificationLifecycle(
  timestamp: string | null,
): EchoSpeakerVerificationLifecycle {
  return {
    version: ECHO_SPEAKER_VERIFICATION_VERSION,
    status: "idle",
    previousStatus: null,
    requestedStatus: null,
    transitionReason: "initialization",
    transitionTimestamp: timestamp ?? new Date().toISOString(),
    lastError: null,
    lastResult: null,
    invalidTransitionCount: 0,
  };
}

function normalizeVerificationLifecycle(
  value: unknown,
  timestamp: string | null,
): EchoSpeakerVerificationLifecycle {
  const defaults = createDefaultVerificationLifecycle(timestamp);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoSpeakerVerificationLifecycle>;
  return {
    ...defaults,
    status: normalizeLifecycleStatus(candidate.status),
    previousStatus: normalizeNullableLifecycleStatus(candidate.previousStatus),
    requestedStatus: normalizeNullableLifecycleStatus(
      candidate.requestedStatus,
    ),
    transitionReason: normalizeTransitionReason(candidate.transitionReason),
    transitionTimestamp:
      typeof candidate.transitionTimestamp === "string"
        ? candidate.transitionTimestamp
        : defaults.transitionTimestamp,
    lastError: sanitizeNullableText(candidate.lastError),
    lastResult: normalizeVerificationResult(candidate.lastResult),
    invalidTransitionCount: normalizeCount(candidate.invalidTransitionCount),
  };
}

function normalizeVerificationResult(
  value: unknown,
): EchoSpeakerVerificationResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoSpeakerVerificationResult>;
  const timestamp =
    typeof candidate.evaluatedAt === "string"
      ? candidate.evaluatedAt
      : new Date().toISOString();
  const decision = normalizeDecision(candidate.decision);
  const score =
    typeof candidate.score === "number" && Number.isFinite(candidate.score)
      ? roundScore(candidate.score)
      : null;
  return {
    version: ECHO_SPEAKER_VERIFICATION_VERSION,
    attemptId: sanitizeText(candidate.attemptId) || makeId("verify-speaker"),
    evaluatedAt: timestamp,
    lifecycleStatus: normalizeLifecycleStatus(candidate.lifecycleStatus),
    decision,
    verified: decision === "verifiedUser",
    score,
    thresholds: normalizeThresholds(candidate.thresholds),
    confidence: normalizeAmbientConfidence(candidate.confidence, {
      source: "contextual-listening",
      timestamp,
      contextValid: true,
      rulesValid: true,
      warningCount: 0,
    }),
    reasons: normalizeStringList(candidate.reasons),
    recoveryActions: normalizeRecoveryActions(candidate.recoveryActions),
    stages: normalizeStages(candidate.stages, timestamp),
    comparison: normalizeComparison(candidate.comparison),
    incomingFeatures: normalizeFeatureOrNull(candidate.incomingFeatures),
    voiceActivity: {
      detected: Boolean(candidate.voiceActivity?.detected),
      clipped: Boolean(candidate.voiceActivity?.clipped),
      noisy: Boolean(candidate.voiceActivity?.noisy),
      audioLoss: Boolean(candidate.voiceActivity?.audioLoss),
    },
    environment: normalizeEnvironment(candidate.environment),
    devicePosition: normalizePosition(candidate.devicePosition),
    multiSpeakerRisk: normalizeMultiSpeakerRisk(candidate.multiSpeakerRisk),
    profileStatus:
      candidate.profileStatus === "complete"
        ? "complete"
        : candidate.profileStatus === "needsRecalibration"
          ? "needsRecalibration"
          : candidate.profileStatus === "enrolling"
            ? "enrolling"
            : "notStarted",
    rawAudioRetained: false,
  };
}

function detectVoiceActivity(metrics: EchoAudioSampleMetrics) {
  const audioLoss =
    metrics.corrupted ||
    metrics.durationMs < 650 ||
    !Number.isFinite(metrics.rmsDb);
  const detected =
    !audioLoss &&
    metrics.rmsDb > -64 &&
    metrics.peakDb > -55 &&
    metrics.dynamicRangeDb > 8;
  return {
    detected,
    clipped: metrics.peakDb >= -1 || metrics.clippingRatio > 0.04,
    noisy: metrics.noiseFloorDb > -34,
    audioLoss,
  };
}

function validateProfile(profile: EchoSpeakerProfile): {
  ok: boolean;
  message: string;
} {
  const acceptedSamples = profile.samples.filter(
    (sample) => sample.status === "accepted",
  );
  if (!profile.profileId || acceptedSamples.length === 0) {
    return {
      ok: false,
      message: "Speaker verification requires an enrolled voice profile.",
    };
  }
  if (profile.status !== "complete") {
    return {
      ok: false,
      message: "Voice enrollment must be complete before verification.",
    };
  }
  if (!profile.acousticModel.fingerprintHash) {
    return {
      ok: false,
      message: "Speaker profile acoustic model is incomplete.",
    };
  }
  if (
    acceptedSamples.some(
      (sample) => sample.rawAudioRetained || !sample.features.fingerprint,
    )
  ) {
    return {
      ok: false,
      message: "Speaker profile contains unusable acoustic sample metadata.",
    };
  }
  return { ok: true, message: "Speaker profile comparison is available." };
}

function compareAgainstProfile(input: {
  profile: EchoSpeakerProfile;
  features: EchoAcousticFeatureVector;
  metrics: EchoAudioSampleMetrics;
  environment: EchoCalibrationEnvironment;
  devicePosition: EchoMicrophonePosition;
}): EchoSpeakerVerificationComparison {
  const acceptedSamples = input.profile.samples.filter(
    (sample) => sample.status === "accepted",
  );
  const sampleScores = acceptedSamples
    .map((sample) => ({
      sample,
      score: compareFeatures(input.features, sample.features),
    }))
    .sort((a, b) => b.score - a.score);
  const topScores = sampleScores.slice(0, Math.min(3, sampleScores.length));
  const modelScore = compareModel(input.profile, input.features);
  const calibrationAdjustment = calibrationAdjustmentForEnvironment(
    input.profile,
    input.environment,
    input.devicePosition,
    input.metrics,
  );
  const environmentAdjustment = environmentScoreAdjustment(
    input.environment,
    input.metrics,
  );
  const devicePositionAdjustment = deviceAdjustment(
    input.profile,
    input.devicePosition,
  );
  const multiSpeakerPenalty =
    input.metrics.noiseFloorDb > -30 && input.metrics.dynamicRangeDb > 52
      ? 0.16
      : input.metrics.noiseFloorDb > -35
        ? 0.08
        : 0;

  return {
    profileId: input.profile.profileId,
    sampleCount: acceptedSamples.length,
    comparedSampleIds: topScores.map((entry) => entry.sample.id),
    bestSampleScore: topScores[0]?.score ?? null,
    averageTopScore:
      topScores.length > 0
        ? roundScore(
            topScores.reduce((sum, entry) => sum + entry.score, 0) /
              topScores.length,
          )
        : null,
    modelScore,
    calibrationAdjustment,
    environmentAdjustment,
    devicePositionAdjustment,
    multiSpeakerPenalty,
  };
}

function compareFeatures(
  current: EchoAcousticFeatureVector,
  enrolled: EchoAcousticFeatureVector,
): number {
  const rms = similarity(current.rmsDb, enrolled.rmsDb, 24);
  const dynamic = similarity(
    current.dynamicRangeDb,
    enrolled.dynamicRangeDb,
    34,
  );
  const centroid = similarity(
    current.spectralCentroidHz,
    enrolled.spectralCentroidHz,
    1_800,
  );
  const zeroCrossing = similarity(
    current.zeroCrossingRate,
    enrolled.zeroCrossingRate,
    0.16,
  );
  const noise = similarity(current.noiseFloorDb, enrolled.noiseFloorDb, 36);
  const peak = similarity(current.peakDb, enrolled.peakDb, 32);
  return roundScore(
    centroid * 0.3 +
      zeroCrossing * 0.23 +
      dynamic * 0.17 +
      rms * 0.13 +
      noise * 0.1 +
      peak * 0.07,
  );
}

function compareModel(
  profile: EchoSpeakerProfile,
  features: EchoAcousticFeatureVector,
): number | null {
  if (
    profile.acousticModel.averageRmsDb === null ||
    profile.acousticModel.averageNoiseFloorDb === null ||
    profile.acousticModel.centroidHz === null
  ) {
    return null;
  }
  return roundScore(
    similarity(features.rmsDb, profile.acousticModel.averageRmsDb, 26) * 0.26 +
      similarity(
        features.noiseFloorDb,
        profile.acousticModel.averageNoiseFloorDb,
        38,
      ) *
        0.18 +
      similarity(
        features.spectralCentroidHz,
        profile.acousticModel.centroidHz,
        2_000,
      ) *
        0.38 +
      Math.min(1, profile.acousticModel.sampleCount / 5) * 0.18,
  );
}

function calibrationAdjustmentForEnvironment(
  profile: EchoSpeakerProfile,
  environment: EchoCalibrationEnvironment,
  devicePosition: EchoMicrophonePosition,
  metrics: EchoAudioSampleMetrics,
): number {
  const matching = profile.calibrationProfiles.find(
    (entry) =>
      entry.id === profile.activeCalibrationId ||
      (entry.environment === environment &&
        entry.devicePosition === devicePosition),
  );
  if (!matching) return 0;
  const noiseDelta = metrics.noiseFloorDb - matching.noiseFloorDb;
  const adjustment =
    matching.recommendedConfidenceAdjustment - Math.max(0, noiseDelta) / 120;
  return roundScore(Math.max(-0.18, Math.min(0.04, adjustment)));
}

function environmentScoreAdjustment(
  environment: EchoCalibrationEnvironment,
  metrics: EchoAudioSampleMetrics,
): number {
  if (
    environment === "localGameStore" ||
    environment === "tournament" ||
    environment === "custom"
  ) {
    return metrics.noiseFloorDb > -36 ? -0.08 : -0.03;
  }
  if (environment === "quietRoom") return metrics.noiseFloorDb < -55 ? 0.03 : 0;
  return 0;
}

function deviceAdjustment(
  profile: EchoSpeakerProfile,
  devicePosition: EchoMicrophonePosition,
): number {
  if (profile.deviceCompatibility.positions.includes(devicePosition))
    return 0.03;
  if (profile.deviceCompatibility.positions.length === 0) return 0;
  return -0.04;
}

function assessMultiSpeakerRisk(input: {
  metrics: EchoAudioSampleMetrics;
  profile: EchoSpeakerProfile;
  score: number;
  environment: EchoCalibrationEnvironment;
}): EchoMultiSpeakerRisk {
  const noisyVenue =
    input.environment === "localGameStore" ||
    input.environment === "tournament";
  const highNoise = input.metrics.noiseFloorDb > (noisyVenue ? -33 : -38);
  const highDynamics = input.metrics.dynamicRangeDb > 52;
  const profileNoise = input.profile.acousticModel.averageNoiseFloorDb ?? -60;
  const noiseSpike = input.metrics.noiseFloorDb - profileNoise > 24;
  if ((highNoise && highDynamics) || (noiseSpike && input.score < 0.86)) {
    return "likely";
  }
  if (highNoise || noiseSpike || input.metrics.clippingRatio > 0.02) {
    return "possible";
  }
  return "none";
}

function decideSpeakerVerification(input: {
  score: number;
  thresholds: EchoSpeakerVerificationThresholds;
  multiSpeakerRisk: EchoMultiSpeakerRisk;
  voiceActivity: ReturnType<typeof detectVoiceActivity>;
}): EchoSpeakerVerificationDecision {
  if (input.voiceActivity.clipped || input.voiceActivity.noisy) {
    if (input.score < input.thresholds.verified + 0.05) return "noMatch";
  }
  if (input.multiSpeakerRisk === "likely") {
    return input.score >= input.thresholds.verified + 0.08
      ? "lowConfidenceMatch"
      : "unknownSpeaker";
  }
  if (input.score >= input.thresholds.verified) return "verifiedUser";
  if (input.score >= input.thresholds.lowConfidence)
    return "lowConfidenceMatch";
  if (input.score < input.thresholds.rejectionFloor) return "noMatch";
  return "unknownSpeaker";
}

function createVerificationResult(input: {
  input: EchoSpeakerVerificationInput;
  profile: EchoSpeakerProfile;
  timestamp: string;
  stages: EchoSpeakerVerificationStageRecord[];
  thresholds: EchoSpeakerVerificationThresholds;
  decision: EchoSpeakerVerificationDecision;
  score: number | null;
  level: AmbientConfidenceLevel;
  reasons: string[];
  recoveryActions: EchoSpeakerVerificationRecoveryAction[];
  comparison: EchoSpeakerVerificationComparison;
  incomingFeatures: EchoAcousticFeatureVector | null;
  voiceActivity: ReturnType<typeof detectVoiceActivity>;
  multiSpeakerRisk: EchoMultiSpeakerRisk;
  lifecycleStatus: EchoSpeakerVerificationLifecycleStatus;
}): EchoSpeakerVerificationResult {
  const stages = [...input.stages];
  recordStage(
    stages,
    "result-publication",
    input.decision === "verifiedUser" ? "passed" : "failed",
    input.decision === "verifiedUser"
      ? "Speaker verified as enrolled user."
      : "Speaker verification rejected the incoming audio.",
    input.timestamp,
  );
  completeRemainingStages(stages, input.timestamp);
  const warningCount =
    input.multiSpeakerRisk === "none" && input.decision === "verifiedUser"
      ? 0
      : 1;
  return {
    version: ECHO_SPEAKER_VERIFICATION_VERSION,
    attemptId: makeId("verify-speaker"),
    evaluatedAt: input.timestamp,
    lifecycleStatus: input.lifecycleStatus,
    decision: input.decision,
    verified: input.decision === "verifiedUser",
    score: input.score,
    thresholds: input.thresholds,
    confidence: normalizeAmbientConfidence(
      {
        level: input.level,
        source: "contextual-listening",
        assessedAt: input.timestamp,
        score: input.score,
        reasons: input.reasons,
        validation: {
          contextValid: true,
          rulesValid: input.decision === "verifiedUser",
          warningCount,
        },
      },
      {
        source: "contextual-listening",
        timestamp: input.timestamp,
        contextValid: true,
        rulesValid: input.decision === "verifiedUser",
        warningCount,
      },
    ),
    reasons: input.reasons.map((entry) => entry.slice(0, 240)),
    recoveryActions: input.recoveryActions,
    stages,
    comparison: input.comparison,
    incomingFeatures: input.incomingFeatures,
    voiceActivity: input.voiceActivity,
    environment: input.input.environment,
    devicePosition: input.input.devicePosition,
    multiSpeakerRisk: input.multiSpeakerRisk,
    profileStatus: input.profile.status,
    rawAudioRetained: false,
  };
}

function thresholdsForSensitivity(
  sensitivity: EchoSpeakerVerificationSensitivity,
): EchoSpeakerVerificationThresholds {
  if (sensitivity === "lenient") {
    return { verified: 0.82, lowConfidence: 0.68, rejectionFloor: 0.48 };
  }
  if (sensitivity === "balanced") {
    return { verified: 0.86, lowConfidence: 0.72, rejectionFloor: 0.52 };
  }
  return { verified: 0.9, lowConfidence: 0.76, rejectionFloor: 0.56 };
}

function confidenceLevelForDecision(
  decision: EchoSpeakerVerificationDecision,
  score: number,
  thresholds: EchoSpeakerVerificationThresholds,
): AmbientConfidenceLevel {
  if (decision === "verifiedUser") return "high";
  if (decision === "lowConfidenceMatch") return "low";
  if (score >= thresholds.rejectionFloor) return "low";
  return "unknown";
}

function resultReasons(
  decision: EchoSpeakerVerificationDecision,
  score: number,
  multiSpeakerRisk: EchoMultiSpeakerRisk,
  comparison: EchoSpeakerVerificationComparison,
): string[] {
  const reasons = [
    decisionReason(decision, multiSpeakerRisk),
    `Speaker similarity score ${score}.`,
  ];
  if (comparison.calibrationAdjustment !== 0) {
    reasons.push("Environmental calibration adjusted verification confidence.");
  }
  if (comparison.devicePositionAdjustment < 0) {
    reasons.push("Current microphone position differs from enrollment data.");
  }
  if (comparison.multiSpeakerPenalty > 0) {
    reasons.push("Commander table noise reduced speaker confidence.");
  }
  return reasons;
}

function decisionReason(
  decision: EchoSpeakerVerificationDecision,
  multiSpeakerRisk: EchoMultiSpeakerRisk,
): string {
  if (decision === "verifiedUser") {
    return "Incoming speaker matches the enrolled user.";
  }
  if (decision === "lowConfidenceMatch") {
    return "Incoming speaker is similar but not safe enough to accept.";
  }
  if (decision === "unknownSpeaker") {
    return multiSpeakerRisk === "likely"
      ? "Multiple speakers or table noise made the speaker uncertain."
      : "Incoming speaker could not be verified.";
  }
  return "Incoming speaker does not match the enrolled user.";
}

function voiceActivityReasons(
  voiceActivity: ReturnType<typeof detectVoiceActivity>,
): string[] {
  const reasons: string[] = [];
  if (voiceActivity.audioLoss) reasons.push("Audio was lost or corrupted.");
  if (voiceActivity.clipped) reasons.push("Incoming audio clipped.");
  if (voiceActivity.noisy) reasons.push("Incoming audio was too noisy.");
  if (!voiceActivity.detected) reasons.push("No clear voice was detected.");
  return reasons.length ? reasons : ["Voice activity was not usable."];
}

function recoveryActionsForDecision(
  decision: EchoSpeakerVerificationDecision,
): EchoSpeakerVerificationRecoveryAction[] {
  if (decision === "verifiedUser") return [];
  if (decision === "lowConfidenceMatch") {
    return ["retry", "speak-again", "manual-override"];
  }
  if (decision === "unknownSpeaker") return ["retry", "speak-again"];
  return ["temporary-ignore", "retry"];
}

function transitionReasonForResult(
  result: EchoSpeakerVerificationResult,
): EchoSpeakerVerificationTransitionReason {
  if (result.decision === "verifiedUser") return "verified-user";
  if (result.decision === "lowConfidenceMatch") return "low-confidence-match";
  if (result.decision === "unknownSpeaker") {
    return result.multiSpeakerRisk === "likely"
      ? "multiple-speakers-suspected"
      : "unknown-speaker";
  }
  return "no-match";
}

function createEmptyComparison(
  profile: EchoSpeakerProfile,
): EchoSpeakerVerificationComparison {
  return {
    profileId: profile.profileId,
    sampleCount: profile.samples.length,
    comparedSampleIds: [],
    bestSampleScore: null,
    averageTopScore: null,
    modelScore: null,
    calibrationAdjustment: 0,
    environmentAdjustment: 0,
    devicePositionAdjustment: 0,
    multiSpeakerPenalty: 0,
  };
}

function createVerificationPrivacyState(
  storedData: EchoSpeakerVerificationSettings["privacy"]["storedData"],
): EchoSpeakerVerificationSettings["privacy"] {
  return {
    rawAudioRetained: false,
    storedData,
    cloudVerificationEnabled: false,
  };
}

function recordStage(
  stages: EchoSpeakerVerificationStageRecord[],
  stage: EchoSpeakerVerificationStageName,
  status: EchoSpeakerVerificationStageStatus,
  message: string,
  timestamp: string,
): void {
  stages.push({ stage, status, message: message.slice(0, 240), timestamp });
}

function completeRemainingStages(
  stages: EchoSpeakerVerificationStageRecord[],
  timestamp: string,
): void {
  const seen = new Set(stages.map((entry) => entry.stage));
  for (const stage of STAGE_ORDER) {
    if (!seen.has(stage)) {
      recordStage(stages, stage, "skipped", "Stage skipped.", timestamp);
    }
  }
}

function similarity(current: number, enrolled: number, span: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(enrolled) || span <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, 1 - Math.abs(current - enrolled) / span));
}

function normalizeSensitivity(
  value: unknown,
): EchoSpeakerVerificationSensitivity {
  if (value === "balanced" || value === "lenient") return value;
  return "commanderStrict";
}

function normalizeLifecycleStatus(
  value: unknown,
): EchoSpeakerVerificationLifecycleStatus {
  if (
    value === "initializing" ||
    value === "verifying" ||
    value === "verified" ||
    value === "rejected" ||
    value === "paused" ||
    value === "interrupted" ||
    value === "recovering" ||
    value === "stopped" ||
    value === "failed"
  ) {
    return value;
  }
  return "idle";
}

function normalizeNullableLifecycleStatus(
  value: unknown,
): EchoSpeakerVerificationLifecycleStatus | null {
  return typeof value === "string" ? normalizeLifecycleStatus(value) : null;
}

function normalizeTransitionReason(
  value: unknown,
): EchoSpeakerVerificationTransitionReason {
  const reasons: EchoSpeakerVerificationTransitionReason[] = [
    "initialization",
    "verification-requested",
    "verification-started",
    "verified-user",
    "unknown-speaker",
    "low-confidence-match",
    "no-match",
    "missing-profile",
    "corrupted-profile",
    "microphone-interruption",
    "audio-loss",
    "calibration-mismatch",
    "multiple-speakers-suspected",
    "manual-pause",
    "manual-stop",
    "recovery",
    "reset",
  ];
  return typeof value === "string" &&
    reasons.includes(value as EchoSpeakerVerificationTransitionReason)
    ? (value as EchoSpeakerVerificationTransitionReason)
    : "initialization";
}

function normalizeDecision(value: unknown): EchoSpeakerVerificationDecision {
  if (
    value === "verifiedUser" ||
    value === "lowConfidenceMatch" ||
    value === "noMatch"
  ) {
    return value;
  }
  return "unknownSpeaker";
}

function normalizeThresholds(
  value: unknown,
): EchoSpeakerVerificationThresholds {
  if (!value || typeof value !== "object") {
    return thresholdsForSensitivity("commanderStrict");
  }
  const candidate = value as Partial<EchoSpeakerVerificationThresholds>;
  return {
    verified: finiteScore(candidate.verified, 0.9),
    lowConfidence: finiteScore(candidate.lowConfidence, 0.76),
    rejectionFloor: finiteScore(candidate.rejectionFloor, 0.56),
  };
}

function normalizeComparison(
  value: unknown,
): EchoSpeakerVerificationComparison {
  if (!value || typeof value !== "object") {
    return createEmptyComparison({
      profileId: null,
      samples: [],
    } as unknown as EchoSpeakerProfile);
  }
  const candidate = value as Partial<EchoSpeakerVerificationComparison>;
  return {
    profileId: sanitizeNullableText(candidate.profileId),
    sampleCount: normalizeCount(candidate.sampleCount),
    comparedSampleIds: Array.isArray(candidate.comparedSampleIds)
      ? candidate.comparedSampleIds
          .map(sanitizeText)
          .filter(Boolean)
          .slice(0, 12)
      : [],
    bestSampleScore: nullableScore(candidate.bestSampleScore),
    averageTopScore: nullableScore(candidate.averageTopScore),
    modelScore: nullableScore(candidate.modelScore),
    calibrationAdjustment: finiteSignedScore(
      candidate.calibrationAdjustment,
      0,
    ),
    environmentAdjustment: finiteSignedScore(
      candidate.environmentAdjustment,
      0,
    ),
    devicePositionAdjustment: finiteSignedScore(
      candidate.devicePositionAdjustment,
      0,
    ),
    multiSpeakerPenalty: finiteScore(candidate.multiSpeakerPenalty, 0),
  };
}

function normalizeFeatureOrNull(
  value: unknown,
): EchoAcousticFeatureVector | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoAcousticFeatureVector>;
  return {
    rmsDb: finiteMetric(candidate.rmsDb, -120),
    peakDb: finiteMetric(candidate.peakDb, -120),
    noiseFloorDb: finiteMetric(candidate.noiseFloorDb, -120),
    dynamicRangeDb: finiteMetric(candidate.dynamicRangeDb, 0),
    zeroCrossingRate: finiteMetric(candidate.zeroCrossingRate, 0),
    spectralCentroidHz: finiteMetric(candidate.spectralCentroidHz, 0),
    sampleRate:
      typeof candidate.sampleRate === "number" ? candidate.sampleRate : null,
    channelCount:
      typeof candidate.channelCount === "number"
        ? candidate.channelCount
        : null,
    fingerprint: sanitizeText(candidate.fingerprint) || "unknown",
  };
}

function normalizeStages(
  value: unknown,
  timestamp: string,
): EchoSpeakerVerificationStageRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Partial<EchoSpeakerVerificationStageRecord>;
      const stage =
        typeof candidate.stage === "string" &&
        STAGE_ORDER.includes(
          candidate.stage as EchoSpeakerVerificationStageName,
        )
          ? (candidate.stage as EchoSpeakerVerificationStageName)
          : null;
      if (!stage) return null;
      return {
        stage,
        status:
          candidate.status === "failed" ||
          candidate.status === "skipped" ||
          candidate.status === "pending"
            ? candidate.status
            : "passed",
        message: sanitizeText(candidate.message) || "Verification stage.",
        timestamp:
          typeof candidate.timestamp === "string"
            ? candidate.timestamp
            : timestamp,
      };
    })
    .filter((entry): entry is EchoSpeakerVerificationStageRecord =>
      Boolean(entry),
    );
}

function normalizeRecoveryActions(
  value: unknown,
): EchoSpeakerVerificationRecoveryAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is EchoSpeakerVerificationRecoveryAction =>
      entry === "retry" ||
      entry === "speak-again" ||
      entry === "manual-override" ||
      entry === "temporary-ignore",
  );
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(sanitizeText).filter(Boolean).slice(0, 8)
    : [];
}

function normalizeEnvironment(value: unknown): EchoCalibrationEnvironment {
  if (
    value === "localGameStore" ||
    value === "tournament" ||
    value === "quietRoom" ||
    value === "custom"
  ) {
    return value;
  }
  return "home";
}

function normalizePosition(value: unknown): EchoMicrophonePosition {
  if (
    value === "phoneOnTable" ||
    value === "besidePlaymat" ||
    value === "chargingStand" ||
    value === "custom"
  ) {
    return value;
  }
  return "phoneInHand";
}

function normalizeMultiSpeakerRisk(value: unknown): EchoMultiSpeakerRisk {
  if (value === "possible" || value === "likely") return value;
  return "none";
}

function sanitizeText(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[<>{}`]/g, "")
        .trim()
        .slice(0, 240)
    : "";
}

function sanitizeNullableText(value: unknown): string | null {
  const text = sanitizeText(value);
  return text || null;
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function nullableScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? finiteScore(value, 0)
    : null;
}

function finiteScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? roundScore(Math.max(0, Math.min(1, value)))
    : fallback;
}

function finiteSignedScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? roundScore(Math.max(-1, Math.min(1, value)))
    : fallback;
}

function finiteMetric(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 1000) / 1000
    : fallback;
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}
