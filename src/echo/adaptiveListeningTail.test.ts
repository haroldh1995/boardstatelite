import { describe, expect, it, vi } from "vitest";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import type { FieldState } from "../domain/types";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  genericCreature,
  testCard,
  tracked,
} from "../test/factories";
import { AmbientEventPipeline } from "./ambientEventPipeline";
import {
  EchoAdaptiveListeningTailManager,
  captureAdaptiveListeningTranscript,
  cancelAdaptiveListeningSession,
  createDefaultAdaptiveListeningTailSettings,
  createDefaultAdaptiveListeningTailState,
  finalizeAdaptiveListeningSession,
  finalizeExpiredAdaptiveListeningSession,
  getActiveAdaptiveListeningSession,
  interruptAdaptiveListeningSession,
  normalizeAdaptiveListeningTailSettings,
  normalizeAdaptiveListeningTailState,
  publishAdaptiveListeningFinalizationToPipeline,
  recoverAdaptiveListeningSession,
  startAdaptiveListeningSession,
  syncAdaptiveListeningTailWithAmbientMode,
} from "./adaptiveListeningTail";
import {
  activateListeningWindow,
  getActiveListeningWindow,
} from "./contextualListening";
import { createDefaultMagicCommandGrammarSettings } from "./magicCommandGrammar";
import type { EchoSpeakerVerificationResult } from "./speakerVerificationTypes";

describe("Echo adaptive listening tail", () => {
  it("initializes dormant with privacy-safe, adjustable listening defaults", () => {
    const settings = createDefaultAdaptiveListeningTailSettings();
    const state = createDefaultAdaptiveListeningTailState({
      timestamp: "2026-07-24T00:00:00.000Z",
    });

    expect(settings).toMatchObject({
      enabled: false,
      tailDurationMs: 3000,
      sessionTimeoutMs: 30000,
      sensitivity: "balanced",
      automaticFinalization: true,
      accessibilityAnnouncementsPrepared: true,
      adjustableTimeoutsPrepared: true,
    });
    expect(state.activeSessionId).toBeNull();
    expect(state.feedback.label).toBe("Voice session inactive.");
    expect(state.diagnostics.directBattlefieldMutation).toBe(false);

    expect(
      normalizeAdaptiveListeningTailSettings({
        enabled: true,
        tailDurationMs: -10,
        sessionTimeoutMs: 999999,
        sensitivity: "unsafe",
        automaticFinalization: false,
      }),
    ).toMatchObject({
      enabled: true,
      tailDurationMs: 1000,
      sessionTimeoutMs: 90000,
      sensitivity: "balanced",
      automaticFinalization: false,
    });
  });

  it("captures multiple gameplay commands in one session and finalizes on natural timeout", () => {
    const field = activeField();
    const before = structuredClone(field);
    const settings = createDefaultAdaptiveListeningTailSettings({
      enabled: true,
    });
    const started = startAdaptiveListeningSession(
      createDefaultAdaptiveListeningTailState(),
      {
        field,
        settings,
        timestamp: "2026-07-24T00:00:00.000Z",
      },
    );
    const captured = captureAdaptiveListeningTranscript(started, {
      transcript: "Play Forest, cast Sol Ring.",
      field,
      speakerVerification: verifiedSpeaker(),
      settings,
      grammarSettings: createDefaultMagicCommandGrammarSettings({
        enabled: true,
      }),
      timestamp: "2026-07-24T00:00:01.000Z",
    });
    const active = getActiveAdaptiveListeningSession(captured.state);

    expect(
      captured.acceptedCommands.map((command) => command.intent?.kind),
    ).toEqual(["play-land", "cast-spell"]);
    expect(active?.status).toBe("waitingForTail");
    expect(active?.finalizeAfter).toBe("2026-07-24T00:00:04.000Z");
    expect(field).toEqual(before);

    const finalized = finalizeExpiredAdaptiveListeningSession(captured.state, {
      settings,
      timestamp: "2026-07-24T00:00:04.000Z",
    });
    const finalSession = finalized.sessions.at(-1);

    expect(finalSession?.status).toBe("finalized");
    expect(finalSession?.finalization).toMatchObject({
      reason: "natural-timeout",
      commandCount: 2,
    });
    expect(
      finalSession?.commands.map((command) => command.intent?.kind),
    ).toEqual(["play-land", "cast-spell"]);
  });

  it("extends the tail when additional relevant speech arrives before timeout", () => {
    const field = activeField();
    const settings = createDefaultAdaptiveListeningTailSettings({
      enabled: true,
    });
    const first = captureAdaptiveListeningTranscript(
      createDefaultAdaptiveListeningTailState(),
      {
        transcript: "Play Forest.",
        field,
        speakerVerification: verifiedSpeaker(),
        settings,
        grammarSettings: createDefaultMagicCommandGrammarSettings({
          enabled: true,
        }),
        timestamp: "2026-07-24T00:00:00.000Z",
      },
    );
    const second = captureAdaptiveListeningTranscript(first.state, {
      transcript: "Cast Sol Ring.",
      field,
      speakerVerification: verifiedSpeaker(),
      settings,
      grammarSettings: createDefaultMagicCommandGrammarSettings({
        enabled: true,
      }),
      timestamp: "2026-07-24T00:00:02.000Z",
    });

    expect(getActiveAdaptiveListeningSession(second.state)?.finalizeAfter).toBe(
      "2026-07-24T00:00:05.000Z",
    );
    expect(
      finalizeExpiredAdaptiveListeningSession(second.state, {
        settings,
        timestamp: "2026-07-24T00:00:04.000Z",
      }).activeSessionId,
    ).not.toBeNull();
    expect(
      finalizeExpiredAdaptiveListeningSession(second.state, {
        settings,
        timestamp: "2026-07-24T00:00:05.000Z",
      }).activeSessionId,
    ).toBeNull();
  });

  it("suppresses duplicate partial transcripts while preserving new command ordering", () => {
    const field = activeField();
    const settings = createDefaultAdaptiveListeningTailSettings({
      enabled: true,
    });
    const first = captureAdaptiveListeningTranscript(
      createDefaultAdaptiveListeningTailState(),
      {
        transcript: "Play Forest.",
        field,
        speakerVerification: verifiedSpeaker(),
        settings,
        grammarSettings: createDefaultMagicCommandGrammarSettings({
          enabled: true,
        }),
        timestamp: "2026-07-24T00:00:00.000Z",
      },
    );
    const second = captureAdaptiveListeningTranscript(first.state, {
      transcript: "Play Forest, cast Sol Ring.",
      field,
      speakerVerification: verifiedSpeaker(),
      settings,
      grammarSettings: createDefaultMagicCommandGrammarSettings({
        enabled: true,
      }),
      timestamp: "2026-07-24T00:00:01.000Z",
    });
    const session = getActiveAdaptiveListeningSession(second.state);

    expect(
      second.acceptedCommands.map((command) => command.intent?.kind),
    ).toEqual(["cast-spell"]);
    expect(second.duplicateCommands).toHaveLength(1);
    expect(second.state.duplicateSuppressionCount).toBe(1);
    expect(session?.commands.map((command) => command.status)).toEqual([
      "captured",
      "captured",
    ]);
    expect(
      session?.commands
        .slice()
        .sort((left, right) => left.order - right.order)
        .map((command) => command.intent?.kind),
    ).toEqual(["play-land", "cast-spell"]);
  });

  it("uses contextual windows to constrain vocabulary and reject unrelated follow-up speech", () => {
    const field = {
      ...activeField(),
      contextualListening: activateListeningWindow(
        createDefaultField().contextualListening,
        "landPlay",
        {
          timestamp: "2026-07-24T00:00:00.000Z",
          source: "planner",
        },
      ),
    };
    const settings = createDefaultAdaptiveListeningTailSettings({
      enabled: true,
    });
    const result = captureAdaptiveListeningTranscript(
      createDefaultAdaptiveListeningTailState(),
      {
        transcript: "Forest, attack with Anim Pakal.",
        field,
        speakerVerification: verifiedSpeaker(),
        settings,
        grammarSettings: createDefaultMagicCommandGrammarSettings({
          enabled: true,
        }),
        timestamp: "2026-07-24T00:00:01.000Z",
      },
    );

    expect(getActiveListeningWindow(field.contextualListening)?.kind).toBe(
      "landPlay",
    );
    expect(
      result.acceptedCommands.map((command) => command.intent?.kind),
    ).toEqual(["play-land"]);
    expect(result.rejectedSegments.at(-1)?.status).toBe("rejected");
    expect(result.rejectedSegments.at(-1)?.windowKind).toBe("landPlay");
  });

  it("finalizes immediately after explicit player completion commands", () => {
    const field = activeField();
    const settings = createDefaultAdaptiveListeningTailSettings({
      enabled: true,
    });
    const result = captureAdaptiveListeningTranscript(
      createDefaultAdaptiveListeningTailState(),
      {
        transcript: "Draw for turn, pass.",
        field,
        speakerVerification: verifiedSpeaker(),
        settings,
        grammarSettings: createDefaultMagicCommandGrammarSettings({
          enabled: true,
        }),
        timestamp: "2026-07-24T00:00:00.000Z",
      },
    );

    expect(result.finalization).toMatchObject({
      reason: "explicit-command",
      commandCount: 2,
    });
    expect(result.state.activeSessionId).toBeNull();
    expect(result.state.sessions.at(-1)?.commands.at(-1)?.intent?.kind).toBe(
      "end-turn",
    );
  });

  it("cancels, interrupts, recovers, and finalizes mode changes without duplicating commands", () => {
    const field = activeField();
    const settings = createDefaultAdaptiveListeningTailSettings({
      enabled: true,
    });
    const captured = captureAdaptiveListeningTranscript(
      createDefaultAdaptiveListeningTailState(),
      {
        transcript: "Cast Sol Ring.",
        field,
        speakerVerification: verifiedSpeaker(),
        settings,
        grammarSettings: createDefaultMagicCommandGrammarSettings({
          enabled: true,
        }),
        timestamp: "2026-07-24T00:00:00.000Z",
      },
    );

    expect(
      cancelAdaptiveListeningSession(captured.state, {
        settings,
        timestamp: "2026-07-24T00:00:01.000Z",
      }).sessions.at(-1)?.status,
    ).toBe("cancelled");

    const interrupted = interruptAdaptiveListeningSession(captured.state, {
      settings,
      timestamp: "2026-07-24T00:00:01.000Z",
      reason: "session-interruption",
    });
    expect(interrupted.sessions.at(-1)?.status).toBe("interrupted");
    expect(
      recoverAdaptiveListeningSession(interrupted, {
        field,
        settings,
        timestamp: "2026-07-24T00:00:02.000Z",
      }).sessions.at(-1)?.status,
    ).toBe("recovered");

    const modeFinalized = syncAdaptiveListeningTailWithAmbientMode(
      captured.state,
      {
        ambientMode: "combat",
        settings,
        timestamp: "2026-07-24T00:00:03.000Z",
      },
    );
    expect(modeFinalized.sessions.at(-1)?.finalization?.reason).toBe(
      "ambient-mode-transition",
    );
  });

  it("publishes finalized intents through the canonical Ambient Event Pipeline without direct mutation", () => {
    const field = activeField();
    const settings = createDefaultAdaptiveListeningTailSettings({
      enabled: true,
    });
    const captured = captureAdaptiveListeningTranscript(
      createDefaultAdaptiveListeningTailState(),
      {
        transcript:
          "Create two Soldier tokens and put a +1/+1 counter on Anim Pakal.",
        field,
        speakerVerification: verifiedSpeaker(),
        settings,
        grammarSettings: createDefaultMagicCommandGrammarSettings({
          enabled: true,
        }),
        timestamp: "2026-07-24T00:00:00.000Z",
      },
    );
    const { state, finalization } = finalizeAdaptiveListeningSession(
      captured.state,
      {
        settings,
        timestamp: "2026-07-24T00:00:03.000Z",
      },
    );
    const pipelineResults = publishAdaptiveListeningFinalizationToPipeline({
      field,
      finalization,
      session: state.sessions.at(-1) ?? null,
      pipeline: new AmbientEventPipeline(),
      timestamp: "2026-07-24T00:00:03.000Z",
    });

    expect(finalization?.commandCount).toBe(2);
    expect(pipelineResults).toHaveLength(2);
    expect(pipelineResults.every((result) => result.field === field)).toBe(
      true,
    );
    expect(
      pipelineResults.every(
        (result) => result.diagnostics.lastIntentId !== null,
      ),
    ).toBe(true);
  });

  it("normalizes persisted active sessions to safe finalized state across reloads and imports", () => {
    const field = createDefaultField();
    const settings = createDefaultAdaptiveListeningTailSettings({
      enabled: true,
      tailDurationMs: 7000,
    });
    const active = captureAdaptiveListeningTranscript(
      createDefaultAdaptiveListeningTailState(),
      {
        transcript: "Play Forest.",
        field: activeField(),
        speakerVerification: verifiedSpeaker(),
        settings,
        grammarSettings: createDefaultMagicCommandGrammarSettings({
          enabled: true,
        }),
        timestamp: "2026-07-24T00:00:00.000Z",
      },
    ).state;
    const restored = normalizeAdaptiveListeningTailState(active, {
      fallbackTimestamp: "2026-07-24T00:05:00.000Z",
      sessionId: field.session.id,
      settings,
    });
    const imported = sanitizeImportedField({
      ...field,
      settings: {
        ...field.settings,
        voice: {
          ...field.settings.voice,
          adaptiveListeningTail: {
            enabled: true,
            tailDurationMs: "bad",
            sessionTimeoutMs: -1,
            sensitivity: "unsafe",
          },
        },
      },
      adaptiveListeningTail: active,
    });

    expect(restored.activeSessionId).toBeNull();
    expect(restored.sessions.at(-1)?.finalization?.reason).toBe(
      "application-lifecycle",
    );
    expect(imported?.settings.voice.adaptiveListeningTail).toMatchObject({
      enabled: true,
      tailDurationMs: 3000,
      sessionTimeoutMs: 8000,
      sensitivity: "balanced",
    });
    expect(imported?.adaptiveListeningTail.activeSessionId).toBeNull();
  });

  it("manages subscriptions, automatic timers, diagnostics, and cleanup", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T00:00:00.000Z"));
    const manager = new EchoAdaptiveListeningTailManager(undefined, {
      ...createDefaultAdaptiveListeningTailSettings({ enabled: true }),
    });
    const listener = vi.fn();
    const finalized = vi.fn();
    const timed = new EchoAdaptiveListeningTailManager(
      undefined,
      {
        ...createDefaultAdaptiveListeningTailSettings({ enabled: true }),
      },
      {
        onFinalize: finalized,
      },
    );
    manager.subscribe(listener);
    timed.start({
      field: activeField(),
      speakerVerification: verifiedSpeaker(),
      grammarSettings: createDefaultMagicCommandGrammarSettings({
        enabled: true,
      }),
    });
    timed.capture({ transcript: "Play Forest.", field: activeField() });

    expect(timed.diagnostics().timersActive).toBe(true);
    vi.advanceTimersByTime(3_000);
    expect(finalized).toHaveBeenCalledTimes(1);
    expect(timed.diagnostics()).toMatchObject({
      status: "finalized",
      capturedCommandCount: 1,
      lastFinalizationReason: "natural-timeout",
      directBattlefieldMutation: false,
    });

    manager.start({ field: activeField() });
    expect(listener).toHaveBeenCalled();
    timed.dispose();
    manager.dispose();
    vi.useRealTimers();
  });
});

function activeField(): FieldState {
  const field = normalizeField(
    fieldWith([
      tracked(animPakal()),
      tracked(catharsCrusade()),
      tracked(
        testCard({
          name: "Sol Ring",
          typeLine: "Artifact",
          oracleText: "{T}: Add {C}{C}.",
        }),
      ),
      tracked(
        testCard({
          name: "Command Tower",
          typeLine: "Land",
          oracleText: "{T}: Add one mana of any color.",
        }),
      ),
      genericCreature(),
    ]),
  );
  return {
    ...field,
    ambient: {
      ...field.ambient,
      currentMode: "activeTurn",
      previousMode: "passive",
    },
  };
}

function verifiedSpeaker(): EchoSpeakerVerificationResult {
  return {
    version: 1,
    attemptId: "verify-test",
    evaluatedAt: "2026-07-24T00:00:00.000Z",
    lifecycleStatus: "verified",
    decision: "verifiedUser",
    verified: true,
    score: 0.94,
    thresholds: { verified: 0.9, lowConfidence: 0.76, rejectionFloor: 0.56 },
    confidence: {
      version: 1,
      level: "high",
      source: "contextual-listening",
      assessedAt: "2026-07-24T00:00:00.000Z",
      score: 0.94,
      reasons: ["test speaker"],
      validation: { contextValid: true, rulesValid: true, warningCount: 0 },
    },
    reasons: ["test speaker"],
    recoveryActions: [],
    stages: [],
    comparison: {
      profileId: "speaker-test",
      sampleCount: 3,
      comparedSampleIds: ["sample-1"],
      bestSampleScore: 0.94,
      averageTopScore: 0.94,
      modelScore: 0.94,
      calibrationAdjustment: 0,
      environmentAdjustment: 0,
      devicePositionAdjustment: 0,
      multiSpeakerPenalty: 0,
    },
    incomingFeatures: null,
    voiceActivity: {
      detected: true,
      clipped: false,
      noisy: false,
      audioLoss: false,
    },
    environment: "home",
    devicePosition: "phoneInHand",
    multiSpeakerRisk: "none",
    profileStatus: "complete",
    rawAudioRetained: false,
  };
}
