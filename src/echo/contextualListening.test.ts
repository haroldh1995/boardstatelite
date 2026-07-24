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
  withCounters,
} from "../test/factories";
import {
  EchoContextualListeningManager,
  activateListeningWindow,
  applyListeningWindowToGrammarResult,
  cancelActiveListeningWindow,
  completeActiveListeningWindow,
  createDefaultContextualListeningSettings,
  createDefaultContextualListeningState,
  createListeningWindow,
  deriveListeningWindowKindFromAmbientMode,
  expireListeningWindows,
  getActiveListeningWindow,
  getEntityPrioritySignalsForWindow,
  getListeningWindowDefinition,
  isContextualListeningWindowTransitionAllowed,
  normalizeContextualListeningState,
  recognizeMagicCommandInWindow,
  recoverListeningWindowStack,
  syncContextualListeningWithAmbientMode,
  transitionListeningWindow,
} from "./contextualListening";
import type { EchoListeningWindowKind } from "./contextualListeningTypes";
import { createDefaultMagicCommandGrammarSettings } from "./magicCommandGrammar";
import { parseMagicCommand } from "./magicCommandGrammar";
import type { EchoSpeakerVerificationResult } from "./speakerVerificationTypes";

describe("Echo contextual listening windows", () => {
  it("defines every required listening window with constrained vocabulary and intents", () => {
    const kinds: EchoListeningWindowKind[] = [
      "generalGameplay",
      "landPlay",
      "spellCasting",
      "activatedAbility",
      "triggerResolution",
      "counterModification",
      "tokenCreation",
      "tokenRemoval",
      "lifeAdjustment",
      "commanderDamage",
      "combatPreparation",
      "combatDeclaration",
      "combatResolution",
      "endStep",
      "endTurn",
    ];

    for (const kind of kinds) {
      const definition = getListeningWindowDefinition(kind);

      expect(definition.kind).toBe(kind);
      expect(definition.verbs.length, kind).toBeGreaterThan(0);
      expect(definition.nouns.length, kind).toBeGreaterThan(0);
      expect(definition.intentKinds.length, kind).toBeGreaterThan(0);
      expect(definition.expectedActions.length, kind).toBeGreaterThan(0);
    }
  });

  it("initializes dormant and safely migrates corrupt settings and state", () => {
    const settings = createDefaultContextualListeningSettings({
      enabled: true,
      defaultTimeoutMs: 12_000,
      preserveWindowStackOnRestore: true,
    });
    const normalized = normalizeContextualListeningState(
      {
        activeWindowId: "missing",
        windows: [{ kind: "unknown", status: "listening" }],
        defaultTimeoutMs: "bad",
        maxDepth: 99,
      },
      {
        fallbackTimestamp: "2026-07-23T00:00:00.000Z",
        sessionId: "session-1",
        ambientMode: "passive",
        defaultTimeoutMs: settings.defaultTimeoutMs,
      },
    );

    expect(settings.enabled).toBe(true);
    expect(normalized.sessionId).toBe("session-1");
    expect(normalized.activeWindowId).toBeNull();
    expect(normalized.windows).toEqual([]);
    expect(normalized.defaultTimeoutMs).toBe(12_000);
    expect(normalized.maxDepth).toBe(8);
  });

  it("activates, nests, completes, cancels, and restores listening windows deterministically", () => {
    let state = createDefaultContextualListeningState({
      sessionId: "session-1",
    });
    state = activateListeningWindow(state, "generalGameplay", {
      timestamp: "2026-07-23T00:00:00.000Z",
      source: "ambient-mode",
    });
    const general = getActiveListeningWindow(state);

    state = activateListeningWindow(state, "combatDeclaration", {
      timestamp: "2026-07-23T00:00:01.000Z",
      source: "phase",
      ambientMode: "combat",
      nested: true,
    });
    const combat = getActiveListeningWindow(state);

    expect(general?.status).toBe("activated");
    expect(combat?.kind).toBe("combatDeclaration");
    expect(combat?.parentId).toBe(general?.id);
    expect(state.diagnostics.stackDepth).toBe(2);

    state = completeActiveListeningWindow(state, {
      timestamp: "2026-07-23T00:00:02.000Z",
    });
    expect(getActiveListeningWindow(state)?.id).toBe(general?.id);
    expect(getActiveListeningWindow(state)?.status).toBe("resumed");

    state = cancelActiveListeningWindow(state, {
      timestamp: "2026-07-23T00:00:03.000Z",
    });
    expect(getActiveListeningWindow(state)).toBeNull();
  });

  it("expires timed windows and preserves safe recovery paths", () => {
    const base = createDefaultContextualListeningState({
      sessionId: "session-1",
    });
    const active = activateListeningWindow(base, "tokenCreation", {
      timestamp: "2026-07-23T00:00:00.000Z",
      timeoutMs: 2_000,
      source: "explicit-command",
    });

    const expired = expireListeningWindows(active, "2026-07-23T00:00:03.000Z");
    expect(expired.lastExpiredWindowId).toBe(active.activeWindowId);
    expect(getActiveListeningWindow(expired)).toBeNull();

    const recovered = recoverListeningWindowStack(expired, {
      timestamp: "2026-07-23T00:00:04.000Z",
      ambientMode: "activeTurn",
      reason: "Window expired during command capture.",
    });
    expect(getActiveListeningWindow(recovered)?.kind).toBe("generalGameplay");
    expect(recovered.diagnostics.lastRecoveredWindowId).toBeNull();
  });

  it("derives and syncs windows from Ambient Gameplay mode without creating a second phase tracker", () => {
    expect(deriveListeningWindowKindFromAmbientMode("passive")).toBe(
      "generalGameplay",
    );
    expect(deriveListeningWindowKindFromAmbientMode("combat")).toBe(
      "combatPreparation",
    );
    expect(deriveListeningWindowKindFromAmbientMode("resolution")).toBe(
      "triggerResolution",
    );
    expect(deriveListeningWindowKindFromAmbientMode("postTurn")).toBe(
      "endStep",
    );

    let state = createDefaultContextualListeningState({
      sessionId: "session-1",
    });
    state = syncContextualListeningWithAmbientMode(state, {
      ambientMode: "combat",
      timestamp: "2026-07-23T00:00:00.000Z",
      source: "phase",
    });

    expect(getActiveListeningWindow(state)?.kind).toBe("combatPreparation");
    expect(getActiveListeningWindow(state)?.source).toBe("phase");
  });

  it("allows valid lifecycle transitions and records invalid requests without changing status", () => {
    const window = createListeningWindow("spellCasting", {
      timestamp: "2026-07-23T00:00:00.000Z",
    });

    expect(
      isContextualListeningWindowTransitionAllowed("created", "activated"),
    ).toBe(true);
    expect(
      isContextualListeningWindowTransitionAllowed("destroyed", "activated"),
    ).toBe(false);

    const activated = transitionListeningWindow(window, "activated", {
      timestamp: "2026-07-23T00:00:01.000Z",
    });
    const invalid = transitionListeningWindow(activated, "created", {
      timestamp: "2026-07-23T00:00:02.000Z",
    });

    expect(activated.status).toBe("activated");
    expect(invalid.status).toBe("activated");
    expect(invalid.lifecycle.at(-1)?.reason).toMatch(/Invalid/i);
  });

  it("constrains Magic grammar with the active window and never mutates battlefield state", () => {
    const field = grammarField();
    const before = structuredClone(field);
    const state = activateListeningWindow(
      createDefaultContextualListeningState({ sessionId: field.session.id }),
      "landPlay",
      {
        timestamp: "2026-07-23T00:00:00.000Z",
        source: "planner",
      },
    );
    const window = getActiveListeningWindow(state);

    const land = recognizeMagicCommandInWindow({
      transcript: "Forest.",
      field,
      speakerVerification: verifiedSpeaker(),
      settings: createDefaultMagicCommandGrammarSettings({ enabled: true }),
      timestamp: "2026-07-23T00:00:00.000Z",
      window,
    });
    const attack = recognizeMagicCommandInWindow({
      transcript: "Attack with Anim Pakal.",
      field,
      speakerVerification: verifiedSpeaker(),
      settings: createDefaultMagicCommandGrammarSettings({ enabled: true }),
      timestamp: "2026-07-23T00:00:00.000Z",
      window,
    });

    expect(land.status).toBe("accepted");
    expect(land.grammar.intent?.kind).toBe("play-land");
    expect(land.confidence.level).toBe("high");
    expect(attack.status).toBe("window-mismatch");
    expect(attack.accepted).toBe(false);
    expect(attack.confidence.level).toBe("low");
    expect(attack.recovery.required).toBe(true);
    expect(field).toEqual(before);
    expect(land.directBattlefieldMutation).toBe(false);
  });

  it("prioritizes relevant battlefield entities for focused windows", () => {
    const field = grammarField();
    const landWindow = createListeningWindow("landPlay");
    const combatWindow = createListeningWindow("combatDeclaration");
    const counterWindow = createListeningWindow("counterModification");

    const landSignals = getEntityPrioritySignalsForWindow(landWindow, field);
    const combatSignals = getEntityPrioritySignalsForWindow(
      combatWindow,
      field,
    );
    const counterSignals = getEntityPrioritySignalsForWindow(
      counterWindow,
      field,
    );

    expect(landSignals[0]?.kind).toBe("land");
    expect(combatSignals.some((entry) => entry.kind === "commander")).toBe(
      true,
    );
    expect(counterSignals.some((entry) => entry.kind === "counter")).toBe(true);
  });

  it("routes grammar results through window confidence metadata for later pipeline use", () => {
    const field = grammarField();
    const grammar = parseMagicCommand({
      transcript: "Create two Soldier tokens.",
      field,
      timestamp: "2026-07-23T00:00:00.000Z",
    });
    const result = applyListeningWindowToGrammarResult({
      grammar,
      window: createListeningWindow("tokenCreation"),
      field,
      timestamp: "2026-07-23T00:00:00.000Z",
    });

    expect(result.status).toBe("accepted");
    expect(result.vocabulary.restricted).toBe(true);
    expect(result.vocabulary.allowedIntentKinds).toEqual(["create-token"]);
    expect(result.confidence.reasons.join(" ")).toMatch(/Token Creation/);
    expect(result.grammar.intent?.source).toBe("voice-command");
  });

  it("persists and restores contextual listening state without exposing unfinished controls", () => {
    const field = createDefaultField();
    const synced = normalizeField({
      ...field,
      contextualListening: syncContextualListeningWithAmbientMode(
        field.contextualListening,
        {
          ambientMode: "combat",
          timestamp: "2026-07-23T00:00:00.000Z",
          timeoutMs: null,
        },
      ),
    });

    expect(synced.contextualListening.sessionId).toBe(synced.session.id);
    expect(getActiveListeningWindow(synced.contextualListening)?.kind).toBe(
      "combatPreparation",
    );
    expect(synced.settings.voice.contextualListening.enabled).toBe(false);

    const legacy = createDefaultField() as unknown as Record<string, unknown>;
    delete legacy.contextualListening;
    const imported = sanitizeImportedField(legacy);

    expect(imported?.contextualListening).toMatchObject({
      sessionId: imported?.session.id,
      activeWindowId: null,
    });
  });

  it("keeps subscriptions and diagnostics isolated from UI state", () => {
    const manager = new EchoContextualListeningManager(undefined, undefined, {
      sessionId: "session-1",
      timestamp: "2026-07-23T00:00:00.000Z",
    });
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);

    manager.syncWithAmbientMode("combat", "2026-07-23T00:00:01.000Z");
    const result = manager.recognize({
      transcript: "Attack with Anim Pakal.",
      field: grammarField(),
      speakerVerification: verifiedSpeaker(),
      settings: createDefaultMagicCommandGrammarSettings({ enabled: true }),
      timestamp: "2026-07-23T00:00:02.000Z",
    });
    unsubscribe();
    manager.activate("endTurn", {
      timestamp: "2026-07-23T00:00:03.000Z",
    });

    expect(result.status).toBe("accepted");
    expect(manager.diagnostics()).toMatchObject({
      activeWindowKind: "endTurn",
      grammarConstrained: true,
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

function grammarField(): FieldState {
  return normalizeField(
    fieldWith([
      withCounters(tracked(animPakal()), { "+1/+1": 1 }),
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
}

function verifiedSpeaker(): EchoSpeakerVerificationResult {
  return {
    version: 1,
    attemptId: "verify-test",
    evaluatedAt: "2026-07-23T00:00:00.000Z",
    lifecycleStatus: "verified",
    decision: "verifiedUser",
    verified: true,
    score: 0.94,
    thresholds: { verified: 0.9, lowConfidence: 0.76, rejectionFloor: 0.56 },
    confidence: {
      version: 1,
      level: "high",
      source: "contextual-listening",
      assessedAt: "2026-07-23T00:00:00.000Z",
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
