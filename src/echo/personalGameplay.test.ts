import { describe, expect, it } from "vitest";
import { createDefaultField, normalizeField } from "../domain/field";
import {
  acceptPersonalGameplaySuggestion,
  createDefaultPersonalGameplaySettings,
  createDefaultPersonalGameplayState,
  dismissPersonalGameplaySuggestion,
  normalizePersonalGameplaySettings,
  normalizePersonalGameplayState,
  observePersonalGameplaySignal,
  preparePredictiveIntentAssistance,
  resetPersonalGameplayState,
} from "./personalGameplay";
import type { EchoPersonalGameplayState } from "./personalGameplayTypes";

const timestamp = "2026-07-27T00:00:00.000Z";

describe("Echo personalized gameplay intelligence", () => {
  it("initializes privacy-safe local-only settings and sanitizes corrupt data", () => {
    const field = createDefaultField();
    const settings = normalizePersonalGameplaySettings({
      rawAudioRetained: true,
      transcriptsRetained: true,
      strategicAnalysisEnabled: true,
      deckOptimizationEnabled: true,
      gameplayAutomationEnabled: true,
      minimumObservations: -20,
    });
    const state = normalizePersonalGameplayState({
      observations: [
        {
          label: "best attack for win rate",
          status: "active",
          strategicRecommendation: true,
        },
      ],
      suggestions: [
        {
          message: "Make the optimal attack.",
          preparation: {
            workflow: "combatDeclaration",
            directBattlefieldMutation: true,
            gameplayAutomation: true,
            strategicRecommendation: true,
          },
        },
      ],
      diagnostics: {
        rawAudioRetained: true,
        transcriptsRetained: true,
        strategicAnalysisEnabled: true,
        gameplayAutomationEnabled: true,
        directBattlefieldMutation: true,
      },
    });

    expect(field.settings.personalGameplay).toMatchObject({
      localOnly: true,
      rawAudioRetained: false,
      transcriptsRetained: false,
      strategicAnalysisEnabled: false,
      gameplayAutomationEnabled: false,
    });
    expect(settings).toMatchObject({
      minimumObservations: 2,
      rawAudioRetained: false,
      transcriptsRetained: false,
      strategicAnalysisEnabled: false,
      deckOptimizationEnabled: false,
      gameplayAutomationEnabled: false,
    });
    expect(state.observations).toEqual([]);
    expect(state.diagnostics).toMatchObject({
      localOnly: true,
      rawAudioRetained: false,
      transcriptsRetained: false,
      directBattlefieldMutation: false,
    });
  });

  it("learns repeated non-strategic interactions before suggesting workflow preparation", () => {
    const field = normalizeField(createDefaultField());
    const settings = createDefaultPersonalGameplaySettings({
      minimumObservations: 3,
      learningSensitivity: "balanced",
    });
    let state = createDefaultPersonalGameplayState();

    for (let index = 0; index < 2; index += 1) {
      const result = observePersonalGameplaySignal(
        state,
        {
          kind: "voice-phrase",
          source: "voice-framework",
          outcome: "completed",
          label: "Combat",
          context: {
            ambientMode: "activeTurn",
            workflow: "combatDeclaration",
            sessionId: field.session.id,
          },
          timestamp,
        },
        { field, settings, timestamp },
      );
      state = result.state;
      expect(result.observation?.status).toBe("candidate");
      expect(result.suggestions).toEqual([]);
    }

    const learned = observePersonalGameplaySignal(
      state,
      {
        kind: "voice-phrase",
        source: "voice-framework",
        outcome: "completed",
        label: "Combat",
        context: {
          ambientMode: "activeTurn",
          workflow: "combatDeclaration",
          sessionId: field.session.id,
        },
        timestamp,
      },
      { field, settings, timestamp },
    );

    expect(learned.observation).toMatchObject({
      status: "active",
      strategicRecommendation: false,
    });
    expect(learned.preparation).toMatchObject({
      status: "prepared",
      workflow: "combatDeclaration",
      suggestedListeningWindow: "combatDeclaration",
      directBattlefieldMutation: false,
      gameplayAutomation: false,
      strategicRecommendation: false,
    });
    expect(learned.suggestions[0]).toMatchObject({
      kind: "prepare-combat-declaration",
      message: "Ready to report combat?",
      requiresUserAction: true,
      nonBlocking: true,
      dismissible: true,
      gameplayAutomation: false,
      strategicRecommendation: false,
    });
  });

  it("adapts ergonomic preferences without producing gameplay strategy", () => {
    const settings = createDefaultPersonalGameplaySettings({
      minimumObservations: 2,
      learningSensitivity: "adaptive",
    });
    let state = createDefaultPersonalGameplayState();

    for (let index = 0; index < 2; index += 1) {
      state = observePersonalGameplaySignal(
        state,
        {
          kind: "listening-duration",
          source: "voice-framework",
          outcome: "completed",
          label: "Listening tail duration",
          durationMs: 5200,
          context: { workflow: "listeningWindow" },
          timestamp,
        },
        { settings, timestamp },
      ).state;
    }

    expect(state.preferences.listeningTailDurationMs).toMatchObject({
      value: 5200,
      observationCount: 1,
      userEditable: true,
    });
    expect(state.diagnostics).toMatchObject({
      strategicAnalysisEnabled: false,
      deckOptimizationEnabled: false,
      gameplayAutomationEnabled: false,
    });
  });

  it("prepares predictive assistance without mutating the battlefield", () => {
    const field = normalizeField(createDefaultField());
    const before = structuredClone(field);

    const preparation = preparePredictiveIntentAssistance(field, {
      signal: {
        kind: "voice-phrase",
        source: "voice-framework",
        outcome: "completed",
        label: "Combat",
        context: { workflow: "combatDeclaration" },
        timestamp,
      },
      settings: field.settings.personalGameplay,
      timestamp,
    });

    expect(preparation).toMatchObject({
      status: "prepared",
      workflow: "combatDeclaration",
      suggestedAmbientMode: "combat",
      suggestedListeningWindow: "combatDeclaration",
      requiresUserAction: true,
      directBattlefieldMutation: false,
      gameplayAutomation: false,
    });
    expect(field).toEqual(before);
  });

  it("tracks interrupted sessions and offers explicit resume only", () => {
    const field = normalizeField(createDefaultField());
    const settings = createDefaultPersonalGameplaySettings({
      minimumObservations: 2,
      learningSensitivity: "adaptive",
    });
    let state: EchoPersonalGameplayState = createDefaultPersonalGameplayState();

    for (let index = 0; index < 2; index += 1) {
      state = observePersonalGameplaySignal(
        state,
        {
          kind: "workflow-interruption",
          source: "lifecycle",
          outcome: "interrupted",
          label: "Resume voice session",
          context: {
            workflow: "voiceSessionResume",
            sessionId: field.session.id,
          },
          timestamp,
        },
        { field, settings, timestamp },
      ).state;
    }

    expect(state.interruptedWorkflow).toMatchObject({
      workflow: "voiceSessionResume",
      localOnly: true,
      strategicRecommendation: false,
    });
    expect(state.suggestions[0]).toMatchObject({
      kind: "resume-workflow",
      requiresUserAction: true,
      gameplayAutomation: false,
    });
  });

  it("allows suggestions and preferences to be accepted, dismissed, and reset", () => {
    const settings = createDefaultPersonalGameplaySettings({
      minimumObservations: 2,
      learningSensitivity: "adaptive",
    });
    let state = createDefaultPersonalGameplayState();
    for (let index = 0; index < 2; index += 1) {
      state = observePersonalGameplaySignal(
        state,
        {
          kind: "planner-action",
          source: "planner",
          outcome: "completed",
          label: "Planner action complete",
          context: { workflow: "plannerStep" },
          timestamp,
        },
        { settings, timestamp },
      ).state;
    }

    const suggestion = state.suggestions[0];
    expect(suggestion.status).toBe("available");
    const dismissed = dismissPersonalGameplaySuggestion(state, suggestion.id, {
      settings,
      timestamp,
    });
    expect(dismissed.suggestions[0].status).toBe("dismissed");
    const accepted = acceptPersonalGameplaySuggestion(state, suggestion.id, {
      settings,
      timestamp,
    });
    expect(accepted.suggestions[0].status).toBe("accepted");

    const reset = resetPersonalGameplayState({ timestamp });
    expect(reset.observations).toEqual([]);
    expect(reset.suggestions).toEqual([]);
    expect(reset.diagnostics).toMatchObject({
      lastResetAt: timestamp,
      rawAudioRetained: false,
      transcriptsRetained: false,
    });
  });

  it("survives long-running interaction simulations without gameplay automation", () => {
    const settings = createDefaultPersonalGameplaySettings({
      minimumObservations: 4,
      maxObservationRecords: 40,
    });
    let state = createDefaultPersonalGameplayState();

    for (let index = 0; index < 120; index += 1) {
      state = observePersonalGameplaySignal(
        state,
        {
          kind: index % 2 === 0 ? "screen-access" : "action-strip",
          source: index % 2 === 0 ? "manual-ui" : "action-strip",
          outcome: "completed",
          label:
            index % 2 === 0 ? "Open planner" : "Complete action strip item",
          context: {
            workflow: index % 2 === 0 ? "plannerStep" : "actionStrip",
          },
          timestamp,
        },
        { settings, timestamp },
      ).state;
    }

    expect(state.observations.length).toBeLessThanOrEqual(40);
    expect(
      state.suggestions.every(
        (suggestion) =>
          suggestion.gameplayAutomation === false &&
          suggestion.strategicRecommendation === false &&
          suggestion.directBattlefieldMutation === false,
      ),
    ).toBe(true);
    expect(state.diagnostics.gameplayAutomationEnabled).toBe(false);
  });
});
