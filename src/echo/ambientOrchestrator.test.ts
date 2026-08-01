import { describe, expect, it } from "vitest";
import { setLife as resolveSetLife } from "../domain/engine";
import {
  createDefaultField,
  normalizeField,
  normalizeSettings,
  sanitizeImportedField,
} from "../domain/field";
import type { FieldState } from "../domain/types";
import { ambientEventPipeline } from "./ambientEventPipeline";
import { activateListeningWindow } from "./contextualListening";
import {
  coordinateAmbientOrchestratorEvent,
  createDefaultAmbientOrchestratorSettings,
  createDefaultAmbientOrchestratorState,
  evaluateAmbientOrchestratorHealth,
  normalizeAmbientOrchestratorSettings,
  normalizeAmbientOrchestratorState,
  orchestrateAmbientTranscript,
  recordAmbientPipelineCompletion,
  refreshAmbientOrchestratorContext,
  resetAmbientOrchestratorState,
} from "./ambientOrchestrator";
import type { EchoAmbientOrchestratorSession } from "./ambientOrchestratorTypes";
import type { EchoSpeakerVerificationResult } from "./speakerVerificationTypes";

const timestamp = "2026-07-29T00:00:00.000Z";

function fieldWithGrammar(): FieldState {
  const field = createDefaultField();
  return normalizeField({
    ...field,
    settings: normalizeSettings({
      ...field.settings,
      voice: {
        ...field.settings.voice,
        voiceFeaturesEnabled: true,
        grammar: {
          ...field.settings.voice.grammar,
          enabled: true,
          requireVerifiedSpeaker: false,
        },
      },
    }),
  });
}

function rejectedSpeaker(): EchoSpeakerVerificationResult {
  return {
    version: 1,
    attemptId: "speaker-rejected",
    evaluatedAt: timestamp,
    lifecycleStatus: "rejected",
    decision: "unknownSpeaker",
    verified: false,
    score: 0.2,
    thresholds: {
      verified: 0.86,
      lowConfidence: 0.72,
      rejectionFloor: 0.5,
    },
    confidence: {
      version: 1,
      level: "low",
      source: "voice-command",
      assessedAt: timestamp,
      score: 0.2,
      reasons: ["Unknown speaker rejected."],
      validation: {
        contextValid: false,
        rulesValid: false,
        warningCount: 0,
      },
    },
    reasons: ["Unknown speaker rejected."],
    recoveryActions: ["retry"],
    stages: [],
    comparison: {
      profileId: null,
      sampleCount: 0,
      comparedSampleIds: [],
      bestSampleScore: null,
      averageTopScore: null,
      modelScore: null,
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
    devicePosition: "besidePlaymat",
    multiSpeakerRisk: "possible",
    profileStatus: "complete",
    rawAudioRetained: false,
  };
}

function activeSession(
  id: string,
  status: EchoAmbientOrchestratorSession["status"] = "listening",
): EchoAmbientOrchestratorSession {
  return {
    ...createDefaultAmbientOrchestratorState().sessions[0],
    version: 1,
    id,
    fieldSessionId: "session-1",
    status,
    workflow: "interface",
    source: "voice",
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    interruptedAt: null,
    recoveryReason: null,
    listeningSessionId: null,
    clarificationSessionId: null,
    combatSessionId: null,
    gameplaySessionId: null,
    pendingPreviewIds: [],
    pendingConfirmationIds: [],
    intentIds: [],
    pipelineEventIds: [],
    transcripts: [],
    stages: [],
    directBattlefieldMutation: false,
    gameplayAutomation: false,
    strategicRecommendation: false,
  };
}

describe("Ambient Gameplay Orchestrator", () => {
  it("initializes local-only coordination settings and strips unsafe claims", () => {
    const settings = normalizeAmbientOrchestratorSettings({
      maxRecentSessions: 1000,
      maxRecentMutations: -10,
      directBattlefieldMutation: true,
      gameplayAutomation: true,
      aiStrategyRecommendations: true,
      rulesAuthorityTransferred: true,
    });
    const state = createDefaultAmbientOrchestratorState();

    expect(settings).toMatchObject({
      maxRecentSessions: 50,
      maxRecentMutations: 0,
      localOnly: true,
      directBattlefieldMutation: false,
      gameplayAutomation: false,
      aiStrategyRecommendations: false,
      rulesAuthorityTransferred: false,
    });
    expect(state.diagnostics).toMatchObject({
      status: "idle",
      sessionRestorationPrepared: true,
      workflowRecoveryPrepared: true,
      localOnly: true,
      gameplayAutomation: false,
    });
  });

  it("creates shared context from existing Echo subsystems without mutating the field", () => {
    const base = fieldWithGrammar();
    const field = {
      ...base,
      contextualListening: activateListeningWindow(
        base.contextualListening,
        "combatDeclaration",
        {
          timestamp,
          source: "phase",
          ambientMode: "combat",
        },
      ),
    };
    const before = structuredClone(field);
    const state = refreshAmbientOrchestratorContext(
      field.ambientOrchestrator,
      field,
      {
        timestamp,
        settings: field.settings.ambientOrchestrator,
      },
    );

    expect(state.sharedContext).toMatchObject({
      fieldId: field.id,
      sessionId: field.session.id,
      currentAmbientMode: field.ambient.currentMode,
      currentListeningWindowKind: "combatDeclaration",
      localOnly: true,
      directBattlefieldMutation: false,
    });
    expect(state.health.activeSubsystems).toContain("contextual-listening");
    expect(field).toEqual(before);
  });

  it("coordinates a voice transcript through grammar, context, preview, confirmation, and smart preparation", () => {
    const field = fieldWithGrammar();
    const result = orchestrateAmbientTranscript({
      field,
      transcript: "Pass the turn.",
      timestamp,
      settings: field.settings.ambientOrchestrator,
    });

    expect(result.status).toBe("awaitingConfirmation");
    expect(result.workflow).toBe("endTurn");
    expect(result.grammar?.status).toBe("recognized");
    expect(result.ambientPreview).toMatchObject({
      status: "created",
      requiresApproval: true,
    });
    expect(result.stageRecords.map((stage) => stage.stage)).toEqual([
      "session-created",
      "verified-speaker",
      "grammar",
      "context",
      "entity-resolution",
      "confidence",
      "clarification",
      "gameplay-preview",
      "confirmation",
      "pipeline",
      "undo-availability",
      "smart-suggestions",
      "session-completion",
    ]);
    expect(result.pipelineResult).toBeNull();
    expect(result.event).toBeNull();
    expect(result.directBattlefieldMutation).toBe(false);
    expect(result.gameplayAutomation).toBe(false);
    expect(field.player.life).toBe(40);
  });

  it("rejects unverified speaker input without publishing gameplay", () => {
    const base = createDefaultField();
    const field = normalizeField({
      ...base,
      settings: normalizeSettings({
        ...base.settings,
        voice: {
          ...base.settings.voice,
          voiceFeaturesEnabled: true,
          grammar: {
            ...base.settings.voice.grammar,
            enabled: true,
            requireVerifiedSpeaker: true,
          },
        },
      }),
    });

    const result = orchestrateAmbientTranscript({
      field,
      transcript: "Create two Treasure tokens.",
      speakerVerification: rejectedSpeaker(),
      timestamp,
    });

    expect(result.status).toBe("recovering");
    expect(result.grammar?.status).toBe("rejected");
    expect(result.pipelineResult).toBeNull();
    expect(result.state.diagnostics.localOnly).toBe(true);
  });

  it("records canonical pipeline completion while preserving the existing undo path", () => {
    const field = fieldWithGrammar();
    const outcome = ambientEventPipeline.process({
      field,
      intent: {
        id: "orchestrated-life",
        kind: "modify-life",
        source: "manual",
        confidence: "high",
        payload: { amount: 2 },
      },
      mutation: ({ field: current }) => resolveSetLife(current, 42, "gain"),
      timestamp,
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("Expected completion");
    const state = recordAmbientPipelineCompletion(
      field.ambientOrchestrator,
      outcome.field,
      {
        result: outcome,
        timestamp,
        settings: field.settings.ambientOrchestrator,
      },
    );

    expect(state.recentMutationIds).toContain(outcome.event.id);
    expect(state.diagnostics.lastPipelineEventId).toBe(outcome.event.id);
    expect(outcome.historyEntry.after.player.life).toBe(42);
  });

  it("detects resource ownership conflicts and recovers unsafe persisted sessions", () => {
    const conflicted = createDefaultAmbientOrchestratorState({
      activeSessionId: "one",
      sessions: [activeSession("one"), activeSession("two")],
      resourceOwners: [
        {
          resource: "microphone",
          ownerSessionId: "missing",
          acquiredAt: timestamp,
          status: "owned",
          reason: "Stale owner.",
        },
      ],
    });
    const health = evaluateAmbientOrchestratorHealth(conflicted, {
      timestamp,
    });
    const restored = normalizeAmbientOrchestratorState(conflicted, {
      fallbackTimestamp: timestamp,
      settings: createDefaultAmbientOrchestratorSettings(),
      allowActiveSession: false,
    });

    expect(health.sessionConsistent).toBe(false);
    expect(health.resourceOwnershipValid).toBe(false);
    expect(restored.activeSessionId).toBeNull();
    expect(
      restored.sessions.every((session) => session.status !== "listening"),
    ).toBe(true);
    expect(restored.sessions[0].recoveryReason).toContain("Unsafe active");
  });

  it("persists safely through imports and keeps ambient settings in exported fields", () => {
    const field = normalizeField(fieldWithGrammar());
    const interrupted = coordinateAmbientOrchestratorEvent(
      field.ambientOrchestrator,
      field,
      {
        kind: "workflow-started",
        workflow: "combatDeclaration",
        source: "voice",
        transcript: "Combat",
        timestamp,
      },
      { settings: field.settings.ambientOrchestrator },
    );
    const imported = sanitizeImportedField({
      ...field,
      ambientOrchestrator: interrupted,
      settings: {
        ...field.settings,
        ambientOrchestrator: {
          ...field.settings.ambientOrchestrator,
          smartCoordinationEnabled: false,
        },
      },
    });

    expect(imported).not.toBeNull();
    expect(imported?.ambientOrchestrator.activeSessionId).toBeNull();
    expect(imported?.settings.ambientOrchestrator).toMatchObject({
      smartCoordinationEnabled: false,
      localOnly: true,
      gameplayAutomation: false,
    });
  });

  it("resets to a clean idle lifecycle without carrying transient workflow data", () => {
    const reset = resetAmbientOrchestratorState({ timestamp });

    expect(reset.activeSessionId).toBeNull();
    expect(reset.sessions).toEqual([]);
    expect(
      reset.resourceOwners.every((entry) => entry.status === "available"),
    ).toBe(true);
    expect(reset.health.checkedAt).toBe(timestamp);
  });
});
