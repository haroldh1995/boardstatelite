import { describe, expect, it } from "vitest";
import type { EchoAudioSampleMetrics } from "./listeningTypes";
import {
  DEFAULT_VOICE_ENROLLMENT_PHRASES,
  addEnvironmentCalibration,
  createDefaultVoiceEnrollmentSettings,
  deleteVoiceProfile,
  evaluateRecordingQuality,
  getCurrentEnrollmentPhrase,
  normalizeVoiceEnrollmentSettings,
  recordVoiceEnrollmentSample,
  startVoiceEnrollment,
} from "./voiceEnrollment";

describe("Echo personal voice enrollment", () => {
  it("starts with private defaults and required Magic-themed samples", () => {
    const settings = createDefaultVoiceEnrollmentSettings(
      "2026-07-22T00:00:00.000Z",
    );

    expect(settings.profile.status).toBe("notStarted");
    expect(settings.profile.privacy.rawAudioRetained).toBe(false);
    expect(settings.profile.privacy.cloudUploadEnabled).toBe(false);
    expect(settings.phrases.map((phrase) => phrase.text)).toContain(
      "Play a Forest.",
    );
    expect(new Set(settings.phrases.map((phrase) => phrase.volume))).toEqual(
      new Set(["quiet", "normal", "loud"]),
    );
  });

  it("creates one unified profile from multi-volume enrollment samples", () => {
    let settings = startVoiceEnrollment(
      createDefaultVoiceEnrollmentSettings(),
      "new",
      "2026-07-22T00:00:00.000Z",
    );

    for (
      let index = 0;
      index < DEFAULT_VOICE_ENROLLMENT_PHRASES.length;
      index += 1
    ) {
      expect(getCurrentEnrollmentPhrase(settings)?.id).toBe(
        DEFAULT_VOICE_ENROLLMENT_PHRASES[index].id,
      );
      const result = recordVoiceEnrollmentSample(
        settings,
        sampleMetrics({
          capturedAt: `2026-07-22T00:00:0${index}.000Z`,
          rmsDb:
            DEFAULT_VOICE_ENROLLMENT_PHRASES[index].volume === "loud"
              ? -35
              : -40,
        }),
        `2026-07-22T00:00:1${index}.000Z`,
      );
      expect(result.accepted).toBe(true);
      settings = result.settings;
    }

    expect(settings.profile.status).toBe("complete");
    expect(settings.profile.samples).toHaveLength(5);
    expect(settings.profile.acousticModel.sampleCount).toBe(5);
    expect(settings.profile.acousticModel.volumeCoverage).toEqual([
      "loud",
      "normal",
      "quiet",
    ]);
    expect(settings.profile.privacy.storedData).toBe("acoustic-features-only");
    expect(
      settings.profile.samples.every((sample) => !sample.rawAudioRetained),
    ).toBe(true);
  });

  it("rejects unusable recordings without advancing the enrollment step", () => {
    const settings = startVoiceEnrollment(
      createDefaultVoiceEnrollmentSettings(),
    );
    const rejected = recordVoiceEnrollmentSample(
      settings,
      sampleMetrics({
        durationMs: 200,
        rmsDb: -85,
        peakDb: -80,
        noiseFloorDb: -20,
        corrupted: true,
      }),
    );

    expect(rejected.accepted).toBe(false);
    expect(rejected.settings.profile.samples).toHaveLength(0);
    expect(rejected.settings.session.currentStepIndex).toBe(0);
    expect(rejected.settings.session.rejectedAttempts).toBe(1);
    expect(rejected.quality.issues).toEqual(
      expect.arrayContaining([
        "corrupted-audio",
        "too-short",
        "silence",
        "low-volume",
        "background-noise",
      ]),
    );
  });

  it("classifies clipping, low volume, silence, noise, and corruption", () => {
    expect(
      evaluateRecordingQuality(sampleMetrics({ peakDb: -0.2 }), "normal")
        .issues,
    ).toContain("clipping");
    expect(
      evaluateRecordingQuality(sampleMetrics({ rmsDb: -55 }), "normal").issues,
    ).toContain("low-volume");
    expect(
      evaluateRecordingQuality(sampleMetrics({ rmsDb: -70 }), "quiet").issues,
    ).toContain("silence");
    expect(
      evaluateRecordingQuality(sampleMetrics({ noiseFloorDb: -20 }), "normal")
        .issues,
    ).toContain("background-noise");
    expect(
      evaluateRecordingQuality(sampleMetrics({ corrupted: true }), "normal")
        .issues,
    ).toContain("corrupted-audio");
  });

  it("supports retry, replacement, deletion, additional samples, and calibration", () => {
    const initial = startVoiceEnrollment(
      createDefaultVoiceEnrollmentSettings(),
    );
    const failed = recordVoiceEnrollmentSample(
      initial,
      sampleMetrics({ durationMs: 100 }),
    ).settings;
    const accepted = recordVoiceEnrollmentSample(
      failed,
      sampleMetrics(),
    ).settings;

    expect(accepted.profile.samples).toHaveLength(1);
    expect(accepted.session.currentStepIndex).toBe(1);

    const replacement = startVoiceEnrollment(accepted, "replace");
    expect(replacement.profile.samples).toHaveLength(0);
    expect(replacement.session.mode).toBe("replace");

    const additional = startVoiceEnrollment(accepted, "additional");
    const added = recordVoiceEnrollmentSample(
      additional,
      sampleMetrics(),
    ).settings;
    expect(added.session.status).toBe("complete");
    expect(added.profile.samples).toHaveLength(2);

    const calibrated = addEnvironmentCalibration(added, {
      environment: "localGameStore",
      devicePosition: "besidePlaymat",
      metrics: sampleMetrics({ noiseFloorDb: -42 }),
    });
    expect(calibrated.profile.calibrationProfiles).toHaveLength(1);
    expect(calibrated.profile.calibrationProfiles[0].rawAudioRetained).toBe(
      false,
    );

    const deleted = deleteVoiceProfile(calibrated);
    expect(deleted.profile.status).toBe("notStarted");
    expect(deleted.profile.samples).toHaveLength(0);
  });

  it("normalizes legacy and corrupted enrollment data without retaining raw audio", () => {
    const normalized = normalizeVoiceEnrollmentSettings({
      profile: {
        profileId: "speaker-legacy",
        status: "complete",
        samples: [
          {
            id: "sample-1",
            phraseId: "play-forest-quiet",
            phrase: "Play a Forest.",
            volume: "quiet",
            capturedAt: "2026-07-22T00:00:00.000Z",
            status: "accepted",
            quality: {
              accepted: true,
              score: 95,
              issues: [],
              durationMs: 1500,
              rmsDb: -40,
              peakDb: -8,
              noiseFloorDb: -65,
              clippingRatio: 0,
            },
            features: {
              rmsDb: -40,
              peakDb: -8,
              noiseFloorDb: -65,
              dynamicRangeDb: 57,
              zeroCrossingRate: 0.05,
              spectralCentroidHz: 1200,
              sampleRate: 48000,
              channelCount: 1,
              fingerprint: "legacy",
            },
            rawAudio: "must-not-survive",
            rawAudioRetained: true,
          },
        ],
        privacy: {
          rawAudioRetained: true,
          storedData: "raw-audio",
          cloudUploadEnabled: true,
        },
      },
      session: {
        status: "listening",
        currentStepIndex: 999,
        currentEnvironment: "not-real",
        currentDevicePosition: "bad",
      },
    });

    expect(normalized.profile.samples[0].rawAudioRetained).toBe(false);
    expect(normalized.profile.privacy.rawAudioRetained).toBe(false);
    expect(normalized.profile.privacy.cloudUploadEnabled).toBe(false);
    expect(normalized.profile.status).toBe("enrolling");
    expect(normalized.session.status).toBe("idle");
    expect(normalized.session.currentStepIndex).toBe(4);
    expect(normalized.session.currentEnvironment).toBe("home");
  });
});

function sampleMetrics(
  overrides: Partial<EchoAudioSampleMetrics> = {},
): EchoAudioSampleMetrics {
  return {
    capturedAt: "2026-07-22T00:00:00.000Z",
    durationMs: 1_500,
    sampleRate: 48_000,
    channelCount: 1,
    activeDeviceId: "fake-device",
    activeDeviceLabel: "Fake microphone",
    rmsDb: -38,
    peakDb: -7,
    noiseFloorDb: -65,
    dynamicRangeDb: 58,
    clippingRatio: 0.001,
    zeroCrossingRate: 0.055,
    spectralCentroidHz: 1_200,
    corrupted: false,
    rawAudioRetained: false,
    ...overrides,
  };
}
