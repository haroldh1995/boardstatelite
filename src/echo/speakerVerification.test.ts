import { describe, expect, it } from "vitest";
import type { EchoAudioSampleMetrics } from "./listeningTypes";
import {
  DEFAULT_VOICE_ENROLLMENT_PHRASES,
  addEnvironmentCalibration,
  createDefaultVoiceEnrollmentSettings,
  recordVoiceEnrollmentSample,
  startVoiceEnrollment,
} from "./voiceEnrollment";
import {
  EchoSpeakerVerificationEngine,
  applySpeakerVerificationResult,
  createDefaultSpeakerVerificationSettings,
  isSpeakerVerificationTransitionAllowed,
  normalizeSpeakerVerificationSettings,
  resetSpeakerVerificationSettings,
  transitionSpeakerVerificationLifecycle,
  verifySpeaker,
} from "./speakerVerification";

describe("Echo speaker verification", () => {
  it("verifies the enrolled user with high confidence and no raw audio retention", () => {
    const enrollment = completeEnrollment();
    const result = verifySpeaker({
      profile: enrollment.profile,
      metrics: sampleMetrics(),
      environment: "home",
      devicePosition: "phoneInHand",
      sensitivity: "commanderStrict",
      timestamp: "2026-07-23T00:00:00.000Z",
    });

    expect(result.verified).toBe(true);
    expect(result.decision).toBe("verifiedUser");
    expect(result.confidence.level).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(result.thresholds.verified);
    expect(result.rawAudioRetained).toBe(false);
    expect(result.incomingFeatures?.fingerprint).toBeTruthy();
  });

  it("rejects unknown speakers and low-confidence matches before future command handling", () => {
    const enrollment = completeEnrollment();
    const unknown = verifySpeaker({
      profile: enrollment.profile,
      metrics: sampleMetrics({
        rmsDb: -55,
        peakDb: -22,
        dynamicRangeDb: 26,
        zeroCrossingRate: 0.18,
        spectralCentroidHz: 3_700,
      }),
      environment: "home",
      devicePosition: "phoneInHand",
      sensitivity: "commanderStrict",
    });

    expect(unknown.verified).toBe(false);
    expect(["unknownSpeaker", "noMatch"]).toContain(unknown.decision);
    expect(unknown.confidence.level).not.toBe("high");
    expect(unknown.recoveryActions).toContain("retry");
  });

  it("prefers false-negative recovery in noisy multi-speaker Commander environments", () => {
    const enrollment = completeEnrollment();
    const noisy = verifySpeaker({
      profile: enrollment.profile,
      metrics: sampleMetrics({
        noiseFloorDb: -25,
        peakDb: -6,
        dynamicRangeDb: 62,
      }),
      environment: "localGameStore",
      devicePosition: "besidePlaymat",
      sensitivity: "commanderStrict",
    });

    expect(noisy.verified).toBe(false);
    expect(noisy.multiSpeakerRisk).toBe("likely");
    expect(["unknownSpeaker", "lowConfidenceMatch", "noMatch"]).toContain(
      noisy.decision,
    );
    expect(noisy.reasons.join(" ")).toMatch(/noise|speaker|confidence/i);
  });

  it("uses calibration and microphone position without creating another profile", () => {
    const enrollment = addEnvironmentCalibration(completeEnrollment(), {
      environment: "localGameStore",
      devicePosition: "besidePlaymat",
      metrics: sampleMetrics({ noiseFloorDb: -42, peakDb: -18 }),
    });
    const result = verifySpeaker({
      profile: enrollment.profile,
      metrics: sampleMetrics({ noiseFloorDb: -42, peakDb: -8 }),
      environment: "localGameStore",
      devicePosition: "besidePlaymat",
      sensitivity: "balanced",
    });

    expect(enrollment.profile.profileId).toBeTruthy();
    expect(enrollment.profile.calibrationProfiles).toHaveLength(1);
    expect(result.comparison.profileId).toBe(enrollment.profile.profileId);
    expect(result.comparison.calibrationAdjustment).toBeLessThanOrEqual(0.05);
  });

  it("fails safely for missing, incomplete, corrupted, or unusable profile data", () => {
    const missing = verifySpeaker({
      profile: createDefaultVoiceEnrollmentSettings().profile,
      metrics: sampleMetrics(),
      environment: "home",
      devicePosition: "phoneInHand",
      sensitivity: "commanderStrict",
    });

    expect(missing.verified).toBe(false);
    expect(missing.decision).toBe("unknownSpeaker");
    expect(missing.lifecycleStatus).toBe("failed");

    const corruptedSettings = normalizeSpeakerVerificationSettings({
      enabled: true,
      lifecycle: {
        status: "verified",
        lastResult: {
          decision: "verifiedUser",
          rawAudioRetained: true,
          confidence: { level: "high", score: 0.95 },
        },
      },
      privacy: {
        rawAudioRetained: true,
        storedData: "raw-audio",
        cloudVerificationEnabled: true,
      },
    });

    expect(corruptedSettings.privacy.rawAudioRetained).toBe(false);
    expect(corruptedSettings.privacy.cloudVerificationEnabled).toBe(false);
    expect(corruptedSettings.lifecycle.lastResult?.rawAudioRetained).toBe(
      false,
    );
  });

  it("provides deterministic lifecycle, recovery, reset, and diagnostics behavior", () => {
    const settings = createDefaultSpeakerVerificationSettings(
      "2026-07-23T00:00:00.000Z",
    );
    expect(isSpeakerVerificationTransitionAllowed("idle", "verifying")).toBe(
      true,
    );
    expect(isSpeakerVerificationTransitionAllowed("idle", "verified")).toBe(
      false,
    );

    const invalid = transitionSpeakerVerificationLifecycle(
      settings.lifecycle,
      "verified",
      {
        reason: "verified-user",
        timestamp: "2026-07-23T00:00:01.000Z",
      },
    );
    expect(invalid.status).toBe("idle");
    expect(invalid.invalidTransitionCount).toBe(1);

    const engine = new EchoSpeakerVerificationEngine(settings);
    const result = engine.verify({
      profile: completeEnrollment().profile,
      metrics: sampleMetrics(),
      environment: "home",
      devicePosition: "phoneInHand",
      sensitivity: "commanderStrict",
    });
    expect(result.verified).toBe(true);
    expect(engine.getDiagnostics().lastDecision).toBe("verifiedUser");

    const paused = engine.pause();
    expect(paused.lifecycle.status).toBe("paused");
    const recovered = engine.recover();
    expect(recovered.lifecycle.status).toBe("recovering");
    const reset = resetSpeakerVerificationSettings(recovered);
    expect(reset.lifecycle.status).toBe("idle");
  });

  it("persists verification result metadata through settings without storing audio", () => {
    const settings = createDefaultSpeakerVerificationSettings();
    const result = verifySpeaker({
      profile: completeEnrollment().profile,
      metrics: sampleMetrics(),
      environment: "home",
      devicePosition: "phoneInHand",
      sensitivity: "commanderStrict",
    });
    const updated = applySpeakerVerificationResult(settings, result);

    expect(updated.enabled).toBe(true);
    expect(updated.lifecycle.lastResult?.decision).toBe("verifiedUser");
    expect(updated.lastVerifiedAt).toBe(result.evaluatedAt);
    expect(updated.privacy.rawAudioRetained).toBe(false);
    expect(updated.privacy.cloudVerificationEnabled).toBe(false);
  });
});

function completeEnrollment() {
  let settings = startVoiceEnrollment(
    createDefaultVoiceEnrollmentSettings(),
    "new",
    "2026-07-23T00:00:00.000Z",
  );
  DEFAULT_VOICE_ENROLLMENT_PHRASES.forEach((phrase, index) => {
    const result = recordVoiceEnrollmentSample(
      settings,
      sampleMetrics({
        capturedAt: `2026-07-23T00:00:0${index}.000Z`,
        rmsDb:
          phrase.volume === "quiet"
            ? -45
            : phrase.volume === "loud"
              ? -35
              : -39,
      }),
      `2026-07-23T00:00:1${index}.000Z`,
    );
    settings = result.settings;
  });
  return settings;
}

function sampleMetrics(
  overrides: Partial<EchoAudioSampleMetrics> = {},
): EchoAudioSampleMetrics {
  return {
    capturedAt: "2026-07-23T00:00:00.000Z",
    durationMs: 1_500,
    sampleRate: 48_000,
    channelCount: 1,
    activeDeviceId: "fake-device",
    activeDeviceLabel: "Fake microphone",
    rmsDb: -39,
    peakDb: -8,
    noiseFloorDb: -65,
    dynamicRangeDb: 57,
    clippingRatio: 0.001,
    zeroCrossingRate: 0.055,
    spectralCentroidHz: 1_200,
    corrupted: false,
    rawAudioRetained: false,
    ...overrides,
  };
}
