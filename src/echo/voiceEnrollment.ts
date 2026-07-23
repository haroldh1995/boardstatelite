import { makeId } from "../domain/cards";
import type { EchoAudioSampleMetrics } from "./listeningTypes";
import {
  ECHO_SPEAKER_PROFILE_VERSION,
  ECHO_VOICE_ENROLLMENT_VERSION,
  type EchoAcousticFeatureVector,
  type EchoCalibrationEnvironment,
  type EchoEnrollmentPhrase,
  type EchoEnrollmentVolume,
  type EchoEnvironmentCalibrationInput,
  type EchoEnvironmentCalibrationProfile,
  type EchoMicrophonePosition,
  type EchoRecordingQuality,
  type EchoRecordingQualityIssue,
  type EchoSpeakerProfile,
  type EchoVoiceEnrollmentResult,
  type EchoVoiceEnrollmentSession,
  type EchoVoiceEnrollmentSettings,
  type EchoVoiceSample,
} from "./voiceEnrollmentTypes";

export const DEFAULT_VOICE_ENROLLMENT_PHRASES: EchoEnrollmentPhrase[] = [
  {
    id: "play-forest-quiet",
    text: "Play a Forest.",
    volume: "quiet",
    focus: "land",
  },
  {
    id: "move-combat-normal",
    text: "Move to combat.",
    volume: "normal",
    focus: "phase",
  },
  {
    id: "pass-turn-loud",
    text: "Pass the turn.",
    volume: "loud",
    focus: "turn",
  },
  {
    id: "create-soldiers-normal",
    text: "Create two Soldier tokens.",
    volume: "normal",
    focus: "token",
  },
  {
    id: "attack-commander-loud",
    text: "Attack with my commander.",
    volume: "loud",
    focus: "combat",
  },
];

const REQUIRED_VOLUMES: EchoEnrollmentVolume[] = ["quiet", "normal", "loud"];
const MINIMUM_DURATION_MS = 900;

export function createDefaultVoiceEnrollmentSettings(
  timestamp: string | null = null,
): EchoVoiceEnrollmentSettings {
  return {
    version: ECHO_VOICE_ENROLLMENT_VERSION,
    profile: createDefaultSpeakerProfile(timestamp),
    session: createDefaultEnrollmentSession(timestamp),
    phrases: DEFAULT_VOICE_ENROLLMENT_PHRASES,
  };
}

export function createDefaultSpeakerProfile(
  timestamp: string | null = null,
): EchoSpeakerProfile {
  return {
    version: ECHO_SPEAKER_PROFILE_VERSION,
    profileId: null,
    status: "notStarted",
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    samples: [],
    requiredPhraseIds: DEFAULT_VOICE_ENROLLMENT_PHRASES.map(
      (phrase) => phrase.id,
    ),
    requiredVolumes: REQUIRED_VOLUMES,
    calibrationProfiles: [],
    activeCalibrationId: null,
    deviceCompatibility: {
      sampleRate: null,
      channelCount: null,
      deviceLabels: [],
      positions: [],
    },
    acousticModel: createEmptyAcousticModel(),
    privacy: {
      rawAudioRetained: false,
      storedData: "none",
      cloudUploadEnabled: false,
    },
  };
}

export function createDefaultEnrollmentSession(
  timestamp: string | null = null,
): EchoVoiceEnrollmentSession {
  return {
    version: ECHO_VOICE_ENROLLMENT_VERSION,
    status: "idle",
    mode: "new",
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    currentStepIndex: 0,
    acceptedSampleIds: [],
    rejectedAttempts: 0,
    lastQuality: null,
    lastError: null,
    currentEnvironment: "home",
    currentDevicePosition: "phoneInHand",
    alternativePacing: false,
  };
}

export function normalizeVoiceEnrollmentSettings(
  value: unknown,
  timestamp: string | null = null,
): EchoVoiceEnrollmentSettings {
  const defaults = createDefaultVoiceEnrollmentSettings(timestamp);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoVoiceEnrollmentSettings>;
  const phrases = normalizePhrases(candidate.phrases);
  return {
    version: ECHO_VOICE_ENROLLMENT_VERSION,
    profile: normalizeSpeakerProfile(candidate.profile, phrases, timestamp),
    session: normalizeEnrollmentSession(candidate.session, phrases, timestamp),
    phrases,
  };
}

export function getCurrentEnrollmentPhrase(
  settings: EchoVoiceEnrollmentSettings,
): EchoEnrollmentPhrase | null {
  const normalized = normalizeVoiceEnrollmentSettings(settings);
  if (
    normalized.session.status !== "active" &&
    normalized.session.status !== "recording" &&
    normalized.session.status !== "sampleRejected" &&
    normalized.session.status !== "sampleAccepted"
  ) {
    return null;
  }
  return (
    normalized.phrases[
      Math.min(
        normalized.session.currentStepIndex,
        normalized.phrases.length - 1,
      )
    ] ?? null
  );
}

export function startVoiceEnrollment(
  value: EchoVoiceEnrollmentSettings,
  mode: EchoVoiceEnrollmentSession["mode"] = "new",
  timestamp = new Date().toISOString(),
): EchoVoiceEnrollmentSettings {
  const settings = normalizeVoiceEnrollmentSettings(value, timestamp);
  const profile =
    mode === "new" || mode === "replace"
      ? {
          ...createDefaultSpeakerProfile(timestamp),
          profileId: makeId("speaker"),
          status: "enrolling" as const,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      : {
          ...settings.profile,
          profileId: settings.profile.profileId ?? makeId("speaker"),
          status:
            mode === "recalibration"
              ? ("needsRecalibration" as const)
              : ("enrolling" as const),
          updatedAt: timestamp,
        };

  return {
    ...settings,
    profile,
    session: {
      ...createDefaultEnrollmentSession(timestamp),
      status: "active",
      mode,
      startedAt: timestamp,
      updatedAt: timestamp,
      currentEnvironment: settings.session.currentEnvironment,
      currentDevicePosition: settings.session.currentDevicePosition,
      alternativePacing: settings.session.alternativePacing,
    },
  };
}

export function updateEnrollmentContext(
  value: EchoVoiceEnrollmentSettings,
  context: {
    environment?: EchoCalibrationEnvironment;
    devicePosition?: EchoMicrophonePosition;
    alternativePacing?: boolean;
  },
  timestamp = new Date().toISOString(),
): EchoVoiceEnrollmentSettings {
  const settings = normalizeVoiceEnrollmentSettings(value, timestamp);
  return {
    ...settings,
    session: {
      ...settings.session,
      updatedAt: timestamp,
      currentEnvironment:
        context.environment ?? settings.session.currentEnvironment,
      currentDevicePosition:
        context.devicePosition ?? settings.session.currentDevicePosition,
      alternativePacing:
        context.alternativePacing ?? settings.session.alternativePacing,
    },
  };
}

export function recordVoiceEnrollmentSample(
  value: EchoVoiceEnrollmentSettings,
  metrics: EchoAudioSampleMetrics,
  timestamp = new Date().toISOString(),
): EchoVoiceEnrollmentResult {
  const settings = normalizeVoiceEnrollmentSettings(value, timestamp);
  const phrase =
    getCurrentEnrollmentPhrase(settings) ?? settings.phrases[0] ?? null;
  if (!phrase) {
    const quality = createRejectedQuality(metrics, ["corrupted-audio"]);
    return {
      settings: markSessionFailure(
        settings,
        "No enrollment phrase is available.",
        quality,
        timestamp,
      ),
      accepted: false,
      completed: false,
      sample: null,
      quality,
      message: "No enrollment phrase is available.",
    };
  }

  const quality = evaluateRecordingQuality(metrics, phrase.volume);
  if (!quality.accepted) {
    return {
      settings: markSessionFailure(
        settings,
        qualityIssueMessage(quality.issues),
        quality,
        timestamp,
      ),
      accepted: false,
      completed: false,
      sample: null,
      quality,
      message: qualityIssueMessage(quality.issues),
    };
  }

  const sample = createVoiceSample({
    phrase,
    metrics,
    quality,
    environment: settings.session.currentEnvironment,
    devicePosition: settings.session.currentDevicePosition,
    timestamp,
  });
  const samples = [...settings.profile.samples, sample];
  const profile = rebuildSpeakerProfile(
    {
      ...settings.profile,
      profileId: settings.profile.profileId ?? makeId("speaker"),
      status: "enrolling",
      createdAt: settings.profile.createdAt ?? timestamp,
      updatedAt: timestamp,
      samples,
      privacy: {
        rawAudioRetained: false,
        storedData: "acoustic-features-only",
        cloudUploadEnabled: false,
      },
    },
    timestamp,
  );
  const completed =
    settings.session.mode === "additional"
      ? true
      : isSpeakerProfileComplete(profile, settings.phrases);
  const sessionComplete =
    completed ||
    settings.session.currentStepIndex >= settings.phrases.length - 1;
  const nextProfile = completed
    ? {
        ...profile,
        status: "complete" as const,
        completedAt: profile.completedAt ?? timestamp,
        updatedAt: timestamp,
      }
    : profile;

  return {
    settings: {
      ...settings,
      profile: nextProfile,
      session: {
        ...settings.session,
        status: sessionComplete ? "complete" : "sampleAccepted",
        updatedAt: timestamp,
        completedAt: sessionComplete ? timestamp : null,
        currentStepIndex: sessionComplete
          ? settings.session.currentStepIndex
          : settings.session.currentStepIndex + 1,
        acceptedSampleIds: [...settings.session.acceptedSampleIds, sample.id],
        lastQuality: quality,
        lastError: null,
      },
    },
    accepted: true,
    completed: sessionComplete,
    sample,
    quality,
    message: sessionComplete
      ? "Voice enrollment is complete."
      : "Voice sample accepted.",
  };
}

export function deleteVoiceProfile(
  value: EchoVoiceEnrollmentSettings,
  timestamp = new Date().toISOString(),
): EchoVoiceEnrollmentSettings {
  const settings = normalizeVoiceEnrollmentSettings(value, timestamp);
  return {
    ...settings,
    profile: createDefaultSpeakerProfile(timestamp),
    session: createDefaultEnrollmentSession(timestamp),
  };
}

export function addEnvironmentCalibration(
  value: EchoVoiceEnrollmentSettings,
  input: EchoEnvironmentCalibrationInput,
  timestamp = new Date().toISOString(),
): EchoVoiceEnrollmentSettings {
  const settings = normalizeVoiceEnrollmentSettings(value, timestamp);
  const calibration = createEnvironmentCalibration(input, timestamp);
  return {
    ...settings,
    profile: rebuildSpeakerProfile(
      {
        ...settings.profile,
        calibrationProfiles: [
          ...settings.profile.calibrationProfiles.filter(
            (entry) => entry.id !== calibration.id,
          ),
          calibration,
        ],
        activeCalibrationId: calibration.id,
        updatedAt: timestamp,
        privacy: {
          rawAudioRetained: false,
          storedData:
            settings.profile.samples.length > 0
              ? "acoustic-features-only"
              : "calibration-features-only",
          cloudUploadEnabled: false,
        },
      },
      timestamp,
    ),
    session: {
      ...settings.session,
      updatedAt: timestamp,
      currentEnvironment: input.environment,
      currentDevicePosition: input.devicePosition,
    },
  };
}

export function evaluateRecordingQuality(
  metrics: EchoAudioSampleMetrics,
  volume: EchoEnrollmentVolume = "normal",
): EchoRecordingQuality {
  const issues: EchoRecordingQualityIssue[] = [];
  if (metrics.corrupted || !Number.isFinite(metrics.rmsDb)) {
    issues.push("corrupted-audio");
  }
  if (metrics.durationMs < MINIMUM_DURATION_MS) issues.push("too-short");
  if (metrics.rmsDb <= -63) issues.push("silence");
  if (metrics.rmsDb < minimumRmsForVolume(volume)) issues.push("low-volume");
  if (metrics.peakDb >= -1 || metrics.clippingRatio > 0.03) {
    issues.push("clipping");
  }
  if (metrics.noiseFloorDb > -32) issues.push("background-noise");

  const uniqueIssues = [...new Set(issues)];
  const score = Math.max(
    0,
    100 -
      uniqueIssues.reduce(
        (penalty, issue) => penalty + qualityPenalty(issue),
        0,
      ),
  );
  return {
    accepted: uniqueIssues.length === 0,
    score,
    issues: uniqueIssues,
    durationMs: metrics.durationMs,
    rmsDb: roundMetric(metrics.rmsDb),
    peakDb: roundMetric(metrics.peakDb),
    noiseFloorDb: roundMetric(metrics.noiseFloorDb),
    clippingRatio: roundMetric(metrics.clippingRatio, 4),
  };
}

export function isSpeakerProfileComplete(
  profile: EchoSpeakerProfile,
  phrases: EchoEnrollmentPhrase[] = DEFAULT_VOICE_ENROLLMENT_PHRASES,
): boolean {
  const acceptedPhraseIds = new Set(
    profile.samples
      .filter((sample) => sample.status === "accepted")
      .map((sample) => sample.phraseId),
  );
  const acceptedVolumes = new Set(
    profile.samples
      .filter((sample) => sample.status === "accepted")
      .map((sample) => sample.volume),
  );
  return (
    phrases.every((phrase) => acceptedPhraseIds.has(phrase.id)) &&
    REQUIRED_VOLUMES.every((volume) => acceptedVolumes.has(volume))
  );
}

function createVoiceSample(input: {
  phrase: EchoEnrollmentPhrase;
  metrics: EchoAudioSampleMetrics;
  quality: EchoRecordingQuality;
  environment: EchoCalibrationEnvironment;
  devicePosition: EchoMicrophonePosition;
  timestamp: string;
}): EchoVoiceSample {
  return {
    id: makeId("voice-sample"),
    phraseId: input.phrase.id,
    phrase: input.phrase.text,
    volume: input.phrase.volume,
    capturedAt: input.timestamp,
    status: "accepted",
    quality: input.quality,
    features: createFeatureVector(input.metrics, input.phrase.volume),
    deviceId: input.metrics.activeDeviceId,
    deviceLabel: input.metrics.activeDeviceLabel,
    devicePosition: input.devicePosition,
    environment: input.environment,
    rawAudioRetained: false,
  };
}

function createFeatureVector(
  metrics: EchoAudioSampleMetrics,
  volume: EchoEnrollmentVolume,
): EchoAcousticFeatureVector {
  const featureBuckets = [
    volume,
    Math.round(metrics.rmsDb),
    Math.round(metrics.peakDb),
    Math.round(metrics.noiseFloorDb),
    Math.round(metrics.dynamicRangeDb),
    Math.round(metrics.zeroCrossingRate * 10_000),
    Math.round(metrics.spectralCentroidHz / 25),
    metrics.sampleRate ?? 0,
    metrics.channelCount ?? 0,
  ];
  return {
    rmsDb: roundMetric(metrics.rmsDb),
    peakDb: roundMetric(metrics.peakDb),
    noiseFloorDb: roundMetric(metrics.noiseFloorDb),
    dynamicRangeDb: roundMetric(metrics.dynamicRangeDb),
    zeroCrossingRate: roundMetric(metrics.zeroCrossingRate, 5),
    spectralCentroidHz: roundMetric(metrics.spectralCentroidHz),
    sampleRate: metrics.sampleRate,
    channelCount: metrics.channelCount,
    fingerprint: stableHash(featureBuckets.join("|")),
  };
}

function rebuildSpeakerProfile(
  profile: EchoSpeakerProfile,
  timestamp: string | null,
): EchoSpeakerProfile {
  const acceptedSamples = profile.samples.filter(
    (sample) => sample.status === "accepted",
  );
  const volumeCoverage = [
    ...new Set(acceptedSamples.map((sample) => sample.volume)),
  ].sort();
  const deviceLabels = [
    ...new Set(
      acceptedSamples
        .map((sample) => sample.deviceLabel)
        .filter((label): label is string => Boolean(label)),
    ),
  ];
  const positions = [
    ...new Set(acceptedSamples.map((sample) => sample.devicePosition)),
  ];
  return {
    ...profile,
    updatedAt: timestamp ?? profile.updatedAt,
    samples: acceptedSamples,
    deviceCompatibility: {
      sampleRate: mostCommonNumber(
        acceptedSamples.map((sample) => sample.features.sampleRate),
      ),
      channelCount: mostCommonNumber(
        acceptedSamples.map((sample) => sample.features.channelCount),
      ),
      deviceLabels: deviceLabels.slice(0, 12),
      positions,
    },
    acousticModel: {
      sampleCount: acceptedSamples.length,
      volumeCoverage,
      averageRmsDb: averageNullable(
        acceptedSamples.map((sample) => sample.features.rmsDb),
      ),
      averageNoiseFloorDb: averageNullable(
        acceptedSamples.map((sample) => sample.features.noiseFloorDb),
      ),
      centroidHz: averageNullable(
        acceptedSamples.map((sample) => sample.features.spectralCentroidHz),
      ),
      fingerprintHash:
        acceptedSamples.length > 0
          ? stableHash(
              acceptedSamples
                .map((sample) => sample.features.fingerprint)
                .sort()
                .join("|"),
            )
          : null,
    },
  };
}

function createEnvironmentCalibration(
  input: EchoEnvironmentCalibrationInput,
  timestamp: string,
): EchoEnvironmentCalibrationProfile {
  const noisePressure = Math.max(0, input.metrics.noiseFloorDb + 60) / 40;
  return {
    id: makeId("calibration"),
    label:
      sanitizeText(input.label) ||
      environmentLabel(input.environment, input.devicePosition),
    environment: input.environment,
    devicePosition: input.devicePosition,
    createdAt: timestamp,
    updatedAt: timestamp,
    sampleCount: 1,
    noiseFloorDb: roundMetric(input.metrics.noiseFloorDb),
    peakNoiseDb: roundMetric(input.metrics.peakDb),
    recommendedConfidenceAdjustment: roundMetric(
      Math.max(-0.3, Math.min(0.05, 0.05 - noisePressure * 0.2)),
      3,
    ),
    rawAudioRetained: false,
  };
}

function normalizeSpeakerProfile(
  value: unknown,
  phrases: EchoEnrollmentPhrase[],
  timestamp: string | null,
): EchoSpeakerProfile {
  const defaults = createDefaultSpeakerProfile(timestamp);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoSpeakerProfile>;
  const samples = Array.isArray(candidate.samples)
    ? candidate.samples
        .map(normalizeSample)
        .filter((sample): sample is EchoVoiceSample => Boolean(sample))
    : [];
  const calibrationProfiles = Array.isArray(candidate.calibrationProfiles)
    ? candidate.calibrationProfiles
        .map(normalizeCalibration)
        .filter((profile): profile is EchoEnvironmentCalibrationProfile =>
          Boolean(profile),
        )
    : [];
  const profile = rebuildSpeakerProfile(
    {
      ...defaults,
      profileId:
        typeof candidate.profileId === "string" ? candidate.profileId : null,
      status: normalizeProfileStatus(candidate.status),
      createdAt:
        typeof candidate.createdAt === "string" ? candidate.createdAt : null,
      updatedAt:
        typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
      completedAt:
        typeof candidate.completedAt === "string"
          ? candidate.completedAt
          : null,
      samples,
      requiredPhraseIds: phrases.map((phrase) => phrase.id),
      requiredVolumes: REQUIRED_VOLUMES,
      calibrationProfiles,
      activeCalibrationId:
        typeof candidate.activeCalibrationId === "string"
          ? candidate.activeCalibrationId
          : null,
      privacy: {
        rawAudioRetained: false,
        storedData: samples.length > 0 ? "acoustic-features-only" : "none",
        cloudUploadEnabled: false,
      },
    },
    null,
  );
  if (isSpeakerProfileComplete(profile, phrases)) {
    return {
      ...profile,
      status: "complete",
      completedAt: profile.completedAt ?? timestamp ?? profile.updatedAt,
    };
  }
  if (profile.status === "complete") {
    return {
      ...profile,
      status: samples.length > 0 ? "enrolling" : "notStarted",
      completedAt: null,
    };
  }
  return profile;
}

function normalizeEnrollmentSession(
  value: unknown,
  phrases: EchoEnrollmentPhrase[],
  timestamp: string | null,
): EchoVoiceEnrollmentSession {
  const defaults = createDefaultEnrollmentSession(timestamp);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoVoiceEnrollmentSession>;
  return {
    ...defaults,
    status: normalizeSessionStatus(candidate.status),
    mode: normalizeSessionMode(candidate.mode),
    startedAt:
      typeof candidate.startedAt === "string" ? candidate.startedAt : null,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
    completedAt:
      typeof candidate.completedAt === "string" ? candidate.completedAt : null,
    currentStepIndex: clampInteger(
      candidate.currentStepIndex,
      0,
      phrases.length - 1,
    ),
    acceptedSampleIds: Array.isArray(candidate.acceptedSampleIds)
      ? candidate.acceptedSampleIds
          .map((entry) => (typeof entry === "string" ? entry : ""))
          .filter(Boolean)
          .slice(0, 30)
      : [],
    rejectedAttempts: clampInteger(candidate.rejectedAttempts, 0, 999),
    lastQuality: normalizeQuality(candidate.lastQuality),
    lastError: sanitizeNullableText(candidate.lastError),
    currentEnvironment: normalizeEnvironment(candidate.currentEnvironment),
    currentDevicePosition: normalizePosition(candidate.currentDevicePosition),
    alternativePacing: Boolean(candidate.alternativePacing),
  };
}

function normalizePhrases(value: unknown): EchoEnrollmentPhrase[] {
  if (!Array.isArray(value)) return DEFAULT_VOICE_ENROLLMENT_PHRASES;
  const sanitized = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Partial<EchoEnrollmentPhrase>;
      const id = sanitizeText(candidate.id);
      const text = sanitizeText(candidate.text);
      if (!id || !text) return null;
      return {
        id,
        text,
        volume: normalizeVolume(candidate.volume),
        focus:
          candidate.focus === "phase" ||
          candidate.focus === "turn" ||
          candidate.focus === "token" ||
          candidate.focus === "combat"
            ? candidate.focus
            : "land",
      };
    })
    .filter((entry): entry is EchoEnrollmentPhrase => Boolean(entry));
  return sanitized.length >= 3 ? sanitized : DEFAULT_VOICE_ENROLLMENT_PHRASES;
}

function normalizeSample(value: unknown): EchoVoiceSample | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoVoiceSample>;
  const phraseId = sanitizeText(candidate.phraseId);
  const phrase = sanitizeText(candidate.phrase);
  if (!phraseId || !phrase || !candidate.features || !candidate.quality) {
    return null;
  }
  return {
    id: sanitizeText(candidate.id) || makeId("voice-sample"),
    phraseId,
    phrase,
    volume: normalizeVolume(candidate.volume),
    capturedAt:
      typeof candidate.capturedAt === "string"
        ? candidate.capturedAt
        : new Date().toISOString(),
    status: candidate.status === "rejected" ? "rejected" : "accepted",
    quality: normalizeQuality(candidate.quality) ?? createEmptyQuality(),
    features: normalizeFeatureVector(candidate.features),
    deviceId: sanitizeNullableText(candidate.deviceId),
    deviceLabel: sanitizeNullableText(candidate.deviceLabel),
    devicePosition: normalizePosition(candidate.devicePosition),
    environment: normalizeEnvironment(candidate.environment),
    rawAudioRetained: false,
  };
}

function normalizeCalibration(
  value: unknown,
): EchoEnvironmentCalibrationProfile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoEnvironmentCalibrationProfile>;
  const id = sanitizeText(candidate.id);
  if (!id) return null;
  return {
    id,
    label: sanitizeText(candidate.label) || "Calibration",
    environment: normalizeEnvironment(candidate.environment),
    devicePosition: normalizePosition(candidate.devicePosition),
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date().toISOString(),
    sampleCount: clampInteger(candidate.sampleCount, 1, 999),
    noiseFloorDb: finiteMetric(candidate.noiseFloorDb, -80),
    peakNoiseDb: finiteMetric(candidate.peakNoiseDb, -80),
    recommendedConfidenceAdjustment: finiteMetric(
      candidate.recommendedConfidenceAdjustment,
      0,
    ),
    rawAudioRetained: false,
  };
}

function normalizeFeatureVector(value: unknown): EchoAcousticFeatureVector {
  if (!value || typeof value !== "object") {
    return createFeatureVector(createFallbackMetrics(), "normal");
  }
  const candidate = value as Partial<EchoAcousticFeatureVector>;
  return {
    rmsDb: finiteMetric(candidate.rmsDb, -80),
    peakDb: finiteMetric(candidate.peakDb, -80),
    noiseFloorDb: finiteMetric(candidate.noiseFloorDb, -90),
    dynamicRangeDb: finiteMetric(candidate.dynamicRangeDb, 0),
    zeroCrossingRate: finiteMetric(candidate.zeroCrossingRate, 0),
    spectralCentroidHz: finiteMetric(candidate.spectralCentroidHz, 0),
    sampleRate:
      typeof candidate.sampleRate === "number" ? candidate.sampleRate : null,
    channelCount:
      typeof candidate.channelCount === "number"
        ? candidate.channelCount
        : null,
    fingerprint:
      typeof candidate.fingerprint === "string"
        ? candidate.fingerprint
        : stableHash("fallback"),
  };
}

function normalizeQuality(value: unknown): EchoRecordingQuality | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoRecordingQuality>;
  return {
    accepted: Boolean(candidate.accepted),
    score: clampInteger(candidate.score, 0, 100),
    issues: Array.isArray(candidate.issues)
      ? [
          ...new Set(
            candidate.issues.filter(
              (entry): entry is EchoRecordingQualityIssue =>
                isQualityIssue(entry),
            ),
          ),
        ]
      : [],
    durationMs: clampInteger(candidate.durationMs, 0, 60_000),
    rmsDb: finiteMetric(candidate.rmsDb, -80),
    peakDb: finiteMetric(candidate.peakDb, -80),
    noiseFloorDb: finiteMetric(candidate.noiseFloorDb, -90),
    clippingRatio: finiteMetric(candidate.clippingRatio, 0),
  };
}

function markSessionFailure(
  settings: EchoVoiceEnrollmentSettings,
  message: string,
  quality: EchoRecordingQuality,
  timestamp: string,
): EchoVoiceEnrollmentSettings {
  return {
    ...settings,
    profile: {
      ...settings.profile,
      status:
        settings.profile.status === "complete"
          ? "needsRecalibration"
          : settings.profile.status,
      updatedAt: timestamp,
    },
    session: {
      ...settings.session,
      status: "sampleRejected",
      updatedAt: timestamp,
      rejectedAttempts: settings.session.rejectedAttempts + 1,
      lastQuality: quality,
      lastError: message,
    },
  };
}

function createRejectedQuality(
  metrics: EchoAudioSampleMetrics,
  issues: EchoRecordingQualityIssue[],
): EchoRecordingQuality {
  return {
    accepted: false,
    score: 0,
    issues,
    durationMs: metrics.durationMs,
    rmsDb: metrics.rmsDb,
    peakDb: metrics.peakDb,
    noiseFloorDb: metrics.noiseFloorDb,
    clippingRatio: metrics.clippingRatio,
  };
}

function createEmptyAcousticModel(): EchoSpeakerProfile["acousticModel"] {
  return {
    sampleCount: 0,
    volumeCoverage: [],
    averageRmsDb: null,
    averageNoiseFloorDb: null,
    centroidHz: null,
    fingerprintHash: null,
  };
}

function createEmptyQuality(): EchoRecordingQuality {
  return {
    accepted: false,
    score: 0,
    issues: ["corrupted-audio"],
    durationMs: 0,
    rmsDb: -120,
    peakDb: -120,
    noiseFloorDb: -120,
    clippingRatio: 0,
  };
}

function createFallbackMetrics(): EchoAudioSampleMetrics {
  return {
    capturedAt: new Date().toISOString(),
    durationMs: 0,
    sampleRate: null,
    channelCount: null,
    activeDeviceId: null,
    activeDeviceLabel: null,
    rmsDb: -120,
    peakDb: -120,
    noiseFloorDb: -120,
    dynamicRangeDb: 0,
    clippingRatio: 0,
    zeroCrossingRate: 0,
    spectralCentroidHz: 0,
    corrupted: true,
    rawAudioRetained: false,
  };
}

function environmentLabel(
  environment: EchoCalibrationEnvironment,
  devicePosition: EchoMicrophonePosition,
): string {
  return `${labelFromToken(environment)} - ${labelFromToken(devicePosition)}`;
}

function qualityIssueMessage(issues: EchoRecordingQualityIssue[]): string {
  if (issues.length === 0) return "Voice sample was not accepted.";
  const first = issues[0];
  if (first === "background-noise") return "Too much background noise.";
  if (first === "clipping")
    return "The recording clipped. Try speaking softer.";
  if (first === "low-volume") return "The sample was too quiet.";
  if (first === "silence") return "No clear voice was detected.";
  if (first === "microphone-failure") return "The microphone could not record.";
  if (first === "too-short") return "The recording was too short.";
  return "The audio sample could not be used.";
}

function minimumRmsForVolume(volume: EchoEnrollmentVolume): number {
  if (volume === "quiet") return -58;
  if (volume === "normal") return -48;
  if (volume === "loud") return -42;
  if (volume === "acrossTable") return -46;
  return -40;
}

function qualityPenalty(issue: EchoRecordingQualityIssue): number {
  if (issue === "clipping" || issue === "corrupted-audio") return 55;
  if (issue === "silence" || issue === "microphone-failure") return 80;
  if (issue === "too-short") return 45;
  if (issue === "background-noise") return 35;
  return 30;
}

function mostCommonNumber(values: Array<number | null>): number | null {
  const counts = new Map<number, number>();
  for (const value of values) {
    if (typeof value !== "number") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let winner: number | null = null;
  let winnerCount = 0;
  for (const [value, count] of counts) {
    if (count > winnerCount) {
      winner = value;
      winnerCount = count;
    }
  }
  return winner;
}

function averageNullable(values: number[]): number | null {
  if (values.length === 0) return null;
  return roundMetric(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeProfileStatus(value: unknown): EchoSpeakerProfile["status"] {
  if (
    value === "enrolling" ||
    value === "complete" ||
    value === "needsRecalibration"
  ) {
    return value;
  }
  return "notStarted";
}

function normalizeSessionStatus(
  value: unknown,
): EchoVoiceEnrollmentSession["status"] {
  if (
    value === "active" ||
    value === "recording" ||
    value === "sampleAccepted" ||
    value === "sampleRejected" ||
    value === "complete" ||
    value === "cancelled" ||
    value === "failed"
  ) {
    return value;
  }
  return "idle";
}

function normalizeSessionMode(
  value: unknown,
): EchoVoiceEnrollmentSession["mode"] {
  if (
    value === "replace" ||
    value === "additional" ||
    value === "recalibration"
  ) {
    return value;
  }
  return "new";
}

function normalizeVolume(value: unknown): EchoEnrollmentVolume {
  if (
    value === "quiet" ||
    value === "loud" ||
    value === "acrossTable" ||
    value === "excited"
  ) {
    return value;
  }
  return "normal";
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

function isQualityIssue(value: unknown): value is EchoRecordingQualityIssue {
  return (
    value === "background-noise" ||
    value === "clipping" ||
    value === "low-volume" ||
    value === "silence" ||
    value === "microphone-failure" ||
    value === "too-short" ||
    value === "corrupted-audio"
  );
}

function finiteMetric(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? roundMetric(value)
    : fallback;
}

function roundMetric(value: number, precision = 2): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function clampInteger(value: unknown, min: number, max: number): number {
  return Math.min(
    max,
    Math.max(min, Number.isFinite(value) ? Math.trunc(Number(value)) : min),
  );
}

function sanitizeText(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[<>{}`]/g, "")
        .trim()
        .slice(0, 160)
    : "";
}

function sanitizeNullableText(value: unknown): string | null {
  const sanitized = sanitizeText(value);
  return sanitized || null;
}

function labelFromToken(value: string): string {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
}
