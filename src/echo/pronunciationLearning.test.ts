import { describe, expect, it } from "vitest";
import { createDefaultField, normalizeField } from "../domain/field";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  testCard,
  tracked,
} from "../test/factories";
import { normalizeAmbientConfidence } from "./ambientConfidence";
import { resolveEchoEntity } from "./entityResolution";
import type { EchoSpeakerVerificationResult } from "./speakerVerificationTypes";
import {
  addDeckVocabularyEntry,
  addPersonalVocabularyEntry,
  addPlayerAlias,
  addPlaygroupVocabularyEntry,
  canonicalEntityFromCard,
  canonicalEntityFromGroup,
  createDefaultPronunciationLearningSettings,
  createDefaultPronunciationLearningState,
  normalizePronunciationLearningSettings,
  normalizePronunciationLearningState,
  observePronunciationLearningSignal,
  removePlayerAlias,
  removePronunciationVocabularyEntry,
  resetPronunciationLearningState,
  updatePersonalVocabularyEntry,
} from "./pronunciationLearning";

const timestamp = "2026-07-26T00:00:00.000Z";

describe("Echo pronunciation learning", () => {
  it("initializes local-only privacy-safe settings and migrates corrupt data", () => {
    const field = createDefaultField();
    const settings = normalizePronunciationLearningSettings({
      automaticLearning: false,
      minimumConfirmations: -10,
      maxVocabularyEntries: 2,
      rawAudioRetained: true,
      localOnly: false,
    });

    expect(field.settings.voice.pronunciationLearning).toMatchObject({
      automaticLearning: true,
      rawAudioRetained: false,
      localOnly: true,
    });
    expect(settings).toMatchObject({
      automaticLearning: false,
      minimumConfirmations: 2,
      maxVocabularyEntries: 10,
      rawAudioRetained: false,
      localOnly: true,
    });
    expect(
      normalizePronunciationLearningState({
        entries: [
          {
            phrase: "Bad <phrase>",
            canonical: { label: "Anim Pakal", groupId: "missing" },
            status: "active",
            rawAudioRetained: true,
          },
        ],
        diagnostics: { rawAudioRetained: true, localOnly: false },
      }).diagnostics,
    ).toMatchObject({
      localOnly: true,
      rawAudioRetained: false,
      directBattlefieldMutation: false,
    });
  });

  it("learns pronunciations only after repeated verified confirmations", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const canonical = canonicalEntityFromGroup(field.groups[0]);
    const settings = createDefaultPronunciationLearningSettings({
      minimumConfirmations: 3,
      learningSensitivity: "balanced",
    });
    let state = createDefaultPronunciationLearningState();

    for (let index = 0; index < 2; index += 1) {
      const result = observePronunciationLearningSignal(
        state,
        {
          phrase: "Annie Pickle",
          canonical,
          source: "confirmed-gameplay",
          outcome: "accepted",
          speakerVerification: verifiedSpeaker(),
          entityConfidence: "high",
          intentKind: "custom",
          timestamp,
        },
        { settings, timestamp },
      );
      state = result.state;
      expect(result.decision.action).toBe("candidate-updated");
    }

    const learned = observePronunciationLearningSignal(
      state,
      {
        phrase: "Annie Pickle",
        canonical,
        source: "confirmed-gameplay",
        outcome: "accepted",
        speakerVerification: verifiedSpeaker(),
        entityConfidence: "high",
        intentKind: "custom",
        timestamp,
      },
      { settings, timestamp },
    );

    expect(learned.decision.action).toBe("activated");
    expect(learned.state.entries[0]).toMatchObject({
      phrase: "Annie Pickle",
      status: "active",
      successfulConfirmationCount: 3,
      rawAudioRetained: false,
      userEditable: true,
    });
    expect(learned.state.entries[0].confidenceBoost).toBeGreaterThan(0);
  });

  it("rejects failed learning signals and does not overfit one interaction", () => {
    const field = normalizeField(fieldWith([tracked(catharsCrusade())]));
    const initial = createDefaultPronunciationLearningState();
    const result = observePronunciationLearningSignal(initial, {
      phrase: "Church card",
      canonical: canonicalEntityFromGroup(field.groups[0]),
      source: "successful-recognition",
      outcome: "rejected",
      speakerVerification: verifiedSpeaker(),
      entityConfidence: "low",
      intentKind: "custom",
      timestamp,
    });

    expect(result.decision.action).toBe("rejected");
    expect(result.state.entries).toEqual([]);

    const oneAccepted = observePronunciationLearningSignal(initial, {
      phrase: "Church card",
      canonical: canonicalEntityFromGroup(field.groups[0]),
      source: "successful-recognition",
      outcome: "accepted",
      speakerVerification: verifiedSpeaker(),
      entityConfidence: "high",
      intentKind: "custom",
      timestamp,
    });
    expect(oneAccepted.state.entries[0].status).toBe("candidate");
  });

  it("uses active personal vocabulary during entity resolution without replacing canonical data", () => {
    const cathars = tracked(catharsCrusade());
    const field = normalizeField(fieldWith([cathars]));
    const before = structuredClone(field);
    const state = addPersonalVocabularyEntry(
      createDefaultPronunciationLearningState(),
      {
        phrase: "Church card",
        canonical: canonicalEntityFromGroup(field.groups[0]),
        timestamp,
        settings: field.settings.voice.pronunciationLearning,
      },
    );
    const adaptedField = normalizeField({
      ...field,
      pronunciationLearning: state,
    });

    const result = resolveEchoEntity({
      field: adaptedField,
      text: "Church card",
    });

    expect(result.status).toBe("resolved");
    expect(result.selected?.label).toBe("Cathars' Crusade");
    expect(result.confidence.reasons[0]).toMatch(/Personal vocabulary/);
    expect(field).toEqual(before);
    expect(adaptedField.groups[0].identity?.name).toBe("Cathars' Crusade");
  });

  it("supports player aliases and playgroup vocabulary as local editable mappings", () => {
    const withAlias = addPlayerAlias(
      createDefaultPronunciationLearningState(),
      {
        alias: "Mike",
        displayName: "Michael Anderson",
        owner: "opponent",
        timestamp,
      },
    );
    const field = normalizeField({
      ...createDefaultField(),
      pronunciationLearning: withAlias,
    });

    const result = resolveEchoEntity({
      field,
      text: "Mike",
      expectedKinds: ["player", "opponent"],
    });
    expect(result.status).toBe("resolved");
    expect(result.selected).toMatchObject({
      kind: "opponent",
      label: "Michael Anderson",
    });

    const cardOnly = resolveEchoEntity({
      field,
      text: "Mike",
      expectedKinds: ["card"],
    });
    expect(cardOnly.status).toBe("missing");

    const playgroup = addPlaygroupVocabularyEntry(withAlias, {
      phrase: "Crusade",
      canonical: canonicalEntityFromCard(
        testCard({
          cardId: "cathars-crusade",
          name: "Cathars' Crusade",
          typeLine: "Enchantment",
          oracleText: "",
        }),
      ),
      timestamp,
    });
    expect(playgroup.playgroupVocabulary[0]).toMatchObject({
      scope: "playgroup",
      status: "active",
    });

    const removedAlias = removePlayerAlias(
      playgroup,
      withAlias.playerAliases[0].id,
      {
        timestamp,
      },
    );
    expect(removedAlias.playerAliases).toEqual([]);
  });

  it("supplements deck-specific vocabulary without becoming the sole authority for field mutations", () => {
    const card = testCard({
      cardId: "sky-skiff",
      name: "Sky Skiff",
      typeLine: "Artifact - Vehicle",
      oracleText: "Flying",
    });
    const state = addDeckVocabularyEntry(
      createDefaultPronunciationLearningState(),
      {
        phrase: "Boat",
        card,
        deckContextId: "deck-local",
        timestamp,
      },
    );
    const field = normalizeField({
      ...createDefaultField(),
      pronunciationLearning: state,
    });
    const before = structuredClone(field);

    const result = resolveEchoEntity({
      field,
      text: "Boat",
      deckSnapshot: [card],
      expectedKinds: ["card"],
    });

    expect(result.status).toBe("resolved");
    expect(result.selected).toMatchObject({
      label: "Sky Skiff",
      source: "deck-snapshot",
    });
    expect(result.resolvedEntities).toEqual([]);
    expect(field).toEqual(before);
  });

  it("allows editing, deleting, and resetting learned vocabulary completely", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const state = addPersonalVocabularyEntry(
      createDefaultPronunciationLearningState(),
      {
        phrase: "Anim",
        canonical: canonicalEntityFromGroup(field.groups[0]),
        timestamp,
      },
    );
    const edited = updatePersonalVocabularyEntry(state, state.entries[0].id, {
      phrase: "My moon commander",
      status: "active",
      timestamp,
    });
    expect(edited.entries[0]).toMatchObject({
      phrase: "My moon commander",
      normalizedPhrase: "my moon commander",
    });

    const removed = removePronunciationVocabularyEntry(
      edited,
      edited.entries[0].id,
      { timestamp },
    );
    expect(removed.entries).toEqual([]);
    expect(removed.diagnostics.lastReason).toBe(
      "Learned vocabulary entry deleted.",
    );

    const reset = resetPronunciationLearningState({ timestamp });
    expect(reset.entries).toEqual([]);
    expect(reset.playerAliases).toEqual([]);
    expect(reset.diagnostics).toMatchObject({
      lastResetAt: timestamp,
      rawAudioRetained: false,
      localOnly: true,
    });
  });
});

function verifiedSpeaker(): EchoSpeakerVerificationResult {
  return {
    version: 1,
    attemptId: "attempt-verified",
    evaluatedAt: timestamp,
    lifecycleStatus: "verified",
    decision: "verifiedUser",
    verified: true,
    score: 0.93,
    thresholds: {
      verified: 0.82,
      lowConfidence: 0.68,
      rejectionFloor: 0.42,
    },
    confidence: normalizeAmbientConfidence("high", {
      source: "voice-command",
      timestamp,
    }),
    reasons: ["Verified speaker test fixture."],
    recoveryActions: [],
    stages: [],
    comparison: {
      profileId: "profile-local",
      sampleCount: 6,
      comparedSampleIds: [],
      bestSampleScore: 0.93,
      averageTopScore: 0.91,
      modelScore: 0.9,
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
    devicePosition: "phoneOnTable",
    multiSpeakerRisk: "none",
    profileStatus: "complete",
    rawAudioRetained: false,
  };
}
