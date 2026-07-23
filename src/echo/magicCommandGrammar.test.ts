import { describe, expect, it } from "vitest";
import { normalizeField } from "../domain/field";
import type { FieldState } from "../domain/types";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  genericCreature,
  testCard,
  tracked,
  withCounters,
} from "../test/factories";
import { AmbientEventPipeline } from "./ambientEventPipeline";
import {
  EchoMagicCommandGrammarEngine,
  createDefaultMagicCommandGrammarSettings,
  magicCommandResultToAmbientIntent,
  normalizeMagicCommandGrammarSettings,
  parseMagicCommand,
  recognizeMagicCommand,
} from "./magicCommandGrammar";
import type { EchoMagicCommandGrammarResult } from "./magicCommandGrammarTypes";
import type { EchoSpeakerVerificationResult } from "./speakerVerificationTypes";

describe("Echo Magic command grammar", () => {
  it("keeps the high-level voice grammar disabled until explicitly enabled", () => {
    const result = recognizeMagicCommand({
      transcript: "Cast Sol Ring.",
      field: grammarField(),
      speakerVerification: verifiedSpeaker(),
      settings: createDefaultMagicCommandGrammarSettings(),
      timestamp: "2026-07-23T00:00:00.000Z",
    });

    expect(result.status).toBe("disabled");
    expect(result.intent).toBeNull();
    expect(result.diagnostics.directBattlefieldMutation).toBe(false);
  });

  it("requires verified speaker identity before interpreting future voice commands", () => {
    const result = recognizeMagicCommand({
      transcript: "Cast Sol Ring.",
      field: grammarField(),
      speakerVerification: rejectedSpeaker(),
      settings: createDefaultMagicCommandGrammarSettings({ enabled: true }),
      timestamp: "2026-07-23T00:00:00.000Z",
    });

    expect(result.status).toBe("rejected");
    expect(result.intent).toBeNull();
    expect(result.speakerVerification.accepted).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Speaker verification/i);
  });

  it("normalizes common land-play phrases into the same structured intent", () => {
    const phrases = [
      "I'll play a Forest.",
      "I'm gonna play Forest.",
      "Drop a Forest.",
      "Forest.",
    ];

    const results = phrases.map((transcript) =>
      recognize(transcript, activeField()),
    );

    expect(results.map((result) => result.intent?.kind)).toEqual([
      "play-land",
      "play-land",
      "play-land",
      "play-land",
    ]);
    expect(
      results.map((result) => result.intent?.payload?.primaryLandName),
    ).toEqual(["Forest", "Forest", "Forest", "Forest"]);
    expect(results.at(-1)?.confidence.level).toBe("medium");
  });

  it("normalizes end-turn phrases into one canonical intent", () => {
    const phrases = ["End my turn.", "I'm done.", "I pass.", "Go ahead."];

    expect(phrases.map((phrase) => recognize(phrase).intent?.kind)).toEqual([
      "end-turn",
      "end-turn",
      "end-turn",
      "end-turn",
    ]);
  });

  it("recognizes a broad corpus of Magic gameplay actions without mutating the field", () => {
    const field = grammarField();
    const before = structuredClone(field);
    const cases: Array<[string, string, number | null]> = [
      ["Cast Sol Ring.", "cast-spell", null],
      ["Attack with Anim Pakal.", "attack", null],
      ["Block with Generic creature.", "block", null],
      ["Create two Soldier tokens.", "create-token", 2],
      ["Sacrifice Sol Ring.", "sacrifice-permanent", null],
      ["Destroy Anim Pakal.", "destroy-permanent", null],
      ["Exile Cathars' Crusade.", "exile-permanent", null],
      ["Return Sol Ring to my hand.", "return-permanent", null],
      ["Draw two cards.", "draw-cards", 2],
      ["Discard a card.", "discard-cards", 1],
      ["Tap Sol Ring.", "tap", null],
      ["Untap Sol Ring.", "untap", null],
      ["Add green mana.", "add-mana", null],
      ["Add two +1/+1 counters to Anim Pakal.", "add-counters", 2],
      ["Remove a shield counter from Anim Pakal.", "remove-counters", 1],
      ["Counter target spell.", "counter-spell", null],
      ["Pass priority.", "pass-priority", null],
      ["Hold priority.", "hold-priority", null],
      ["Activate Sol Ring.", "activate-ability", null],
      ["Equip Swiftfoot Boots to Anim Pakal.", "equip", null],
      ["Attach aura to Anim Pakal.", "attach", null],
      ["Transform Anim Pakal.", "transform-permanent", null],
      ["Explore Anim Pakal.", "explore", null],
      ["Surveil two.", "surveil", 2],
      ["Mill three.", "mill-cards", 3],
    ];

    for (const [phrase, expectedKind, expectedQuantity] of cases) {
      const result = recognize(phrase, field);
      expect(result.intent?.kind, phrase).toBe(expectedKind);
      expect(result.intent?.source, phrase).toBe("voice-command");
      expect(result.diagnostics.directBattlefieldMutation, phrase).toBe(false);
      if (expectedQuantity !== null) {
        expect(result.quantity, phrase).toBe(expectedQuantity);
      }
    }
    expect(field).toEqual(before);
  });

  it("surfaces ambiguous battlefield objects instead of guessing", () => {
    const first = tracked(
      testCard({
        name: "Soul Warden",
        typeLine: "Creature - Human Cleric",
        oracleText: "Whenever another creature enters, you gain 1 life.",
      }),
    );
    const second = tracked(
      testCard({
        name: "Soul Warden",
        typeLine: "Creature - Human Cleric",
        oracleText: "Whenever another creature enters, you gain 1 life.",
      }),
    );
    second.id = "group-second-soul-warden";
    const field = normalizeField(
      fieldWith([first, withCounters(second, { Shield: 1 })]),
    );

    const result = recognize("Tap Soul Warden.", field);

    expect(result.status).toBe("ambiguous");
    expect(result.confidence.level).toBe("low");
    expect(result.primaryObject?.ambiguous).toBe(true);
    expect(result.ambiguities[0]?.type).toBe("multiple-objects");
    expect(result.intent?.requiresPreview).toBe(true);
  });

  it("handles incomplete and unknown commands through safe recovery metadata", () => {
    const incomplete = recognize("Sacrifice.");
    const unknown = recognize("Remember the pizza order.");

    expect(incomplete.status).toBe("incomplete");
    expect(incomplete.intent?.requiresPreview).toBe(true);
    expect(incomplete.recovery.correctionTypes).toContain("retry");
    expect(unknown.status).toBe("unknown");
    expect(unknown.intent).toBeNull();
    expect(unknown.recovery.correctionTypes).toContain("ignore-phrase");
  });

  it("uses Ambient mode as context for bare phrases without creating a second turn tracker", () => {
    const active = parseMagicCommand({
      transcript: "Forest.",
      field: activeField(),
      timestamp: "2026-07-23T00:00:00.000Z",
    });
    const passive = parseMagicCommand({
      transcript: "Forest.",
      field: grammarField(),
      timestamp: "2026-07-23T00:00:00.000Z",
    });

    expect(active.intent?.kind).toBe("play-land");
    expect(active.interpretedPhrase).toBe("play forest");
    expect(passive.status).toBe("unknown");
  });

  it("feeds recognized intents into the canonical Ambient Event Pipeline without direct mutation", () => {
    const field = activeField();
    const result = recognize("Cast Sol Ring.", field);
    const intent = magicCommandResultToAmbientIntent(result);
    const pipeline = new AmbientEventPipeline();
    const processed = pipeline.process({
      field,
      intent: intent!,
      timestamp: "2026-07-23T00:00:00.000Z",
    });

    expect(intent?.kind).toBe("cast-spell");
    expect(processed.status).toBe("rejected");
    expect(processed.field).toEqual(field);
    expect(processed.event?.intent.source).toBe("voice-command");
    expect(processed.event?.result.summary.join(" ")).toMatch(
      /No Ambient battlefield mutation handler/i,
    );
  });

  it("normalizes settings, diagnostics, and localization-ready metadata safely", () => {
    const settings = normalizeMagicCommandGrammarSettings({
      enabled: true,
      requireVerifiedSpeaker: false,
      locale: "fr-FR",
      diagnosticsEnabled: true,
      testingEnabled: true,
      languageSelectionPrepared: false,
      lastResetAt: "2026-07-23T00:00:00.000Z",
    });
    const engine = new EchoMagicCommandGrammarEngine(settings);
    const result = engine.recognize({
      transcript: "Draw two.",
      field: grammarField(),
      speakerVerification: null,
      timestamp: "2026-07-23T00:00:00.000Z",
    });

    expect(settings.locale).toBe("en-US");
    expect(settings.languageSelectionPrepared).toBe(true);
    expect(result.intent?.kind).toBe("draw-cards");
    expect(engine.diagnostics()).toMatchObject({
      enabled: true,
      requireVerifiedSpeaker: false,
      locale: "en-US",
      lastStatus: "recognized",
      lastIntentKind: "draw-cards",
      recognizedCount: 1,
      directBattlefieldMutation: false,
    });
  });
});

function recognize(
  transcript: string,
  field: FieldState = grammarField(),
): EchoMagicCommandGrammarResult {
  return recognizeMagicCommand({
    transcript,
    field,
    speakerVerification: verifiedSpeaker(),
    settings: createDefaultMagicCommandGrammarSettings({ enabled: true }),
    timestamp: "2026-07-23T00:00:00.000Z",
  });
}

function grammarField(): FieldState {
  return normalizeField(
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
          name: "Swiftfoot Boots",
          typeLine: "Artifact - Equipment",
          oracleText: "Equipped creature has hexproof and haste. Equip {1}.",
        }),
      ),
      genericCreature(),
    ]),
  );
}

function activeField(): FieldState {
  const field = grammarField();
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
  return speakerResult({
    verified: true,
    decision: "verifiedUser",
    score: 0.94,
  });
}

function rejectedSpeaker(): EchoSpeakerVerificationResult {
  return speakerResult({
    verified: false,
    decision: "unknownSpeaker",
    score: 0.42,
  });
}

function speakerResult(input: {
  verified: boolean;
  decision: EchoSpeakerVerificationResult["decision"];
  score: number;
}): EchoSpeakerVerificationResult {
  return {
    version: 1,
    attemptId: "verify-test",
    evaluatedAt: "2026-07-23T00:00:00.000Z",
    lifecycleStatus: input.verified ? "verified" : "rejected",
    decision: input.decision,
    verified: input.verified,
    score: input.score,
    thresholds: { verified: 0.9, lowConfidence: 0.76, rejectionFloor: 0.56 },
    confidence: {
      version: 1,
      level: input.verified ? "high" : "unknown",
      source: "contextual-listening",
      assessedAt: "2026-07-23T00:00:00.000Z",
      score: input.score,
      reasons: ["test speaker"],
      validation: {
        contextValid: input.verified,
        rulesValid: input.verified,
        warningCount: input.verified ? 0 : 1,
      },
    },
    reasons: ["test speaker"],
    recoveryActions: input.verified ? [] : ["retry"],
    stages: [],
    comparison: {
      profileId: "speaker-test",
      sampleCount: 3,
      comparedSampleIds: ["sample-1"],
      bestSampleScore: input.score,
      averageTopScore: input.score,
      modelScore: input.score,
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
