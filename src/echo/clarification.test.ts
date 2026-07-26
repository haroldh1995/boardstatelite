import { describe, expect, it } from "vitest";
import { normalizeField } from "../domain/field";
import type { PermanentGroup } from "../domain/types";
import { animPakal, fieldWith, testCard, tracked } from "../test/factories";
import { AmbientEventPipeline } from "./ambientEventPipeline";
import { normalizeAmbientConfidence } from "./ambientConfidence";
import { activateListeningWindow } from "./contextualListening";
import { addPlannedAction, syncPlannerWithAmbientMode } from "./preTurnPlanner";
import { synchronizeActionStripWithPlanner } from "./activeTurnActionStrip";
import {
  applyClarificationAnswer,
  cancelClarificationSession,
  createClarificationAwarePipelineRequest,
  createDefaultClarificationSettings,
  createDefaultClarificationState,
  decideClarificationForIntent,
  normalizeClarificationSettings,
  normalizeClarificationState,
  recoverClarificationSession,
  startClarificationSession,
  timeoutClarificationSession,
  updateClarificationSession,
} from "./clarification";
import { resolveEchoEntity } from "./entityResolution";

const timestamp = "2026-07-26T00:00:00.000Z";

describe("Echo conversational clarification", () => {
  it("initializes with concise local-only defaults and sanitizes unsafe settings", () => {
    const settings = createDefaultClarificationSettings();
    const state = createDefaultClarificationState();

    expect(settings).toMatchObject({
      enabled: true,
      confirmationSensitivity: "balanced",
      automaticExecutionThreshold: 0.86,
      quickConfirmationThreshold: 0.62,
      clarificationTimeoutMs: 12000,
      voiceConfirmationEnabled: false,
      accessibilityAnnouncementsPrepared: true,
      localizationReady: true,
    });
    expect(state.pendingPrompt).toBeNull();
    expect(state.diagnostics.directBattlefieldMutation).toBe(false);
    expect(
      normalizeClarificationSettings({
        confirmationSensitivity: "unsafe",
        automaticExecutionThreshold: 9,
        quickConfirmationThreshold: -1,
        clarificationTimeoutMs: 1,
        voiceConfirmationEnabled: true,
        accessibilityAnnouncementsPrepared: false,
        localizationReady: false,
      }),
    ).toMatchObject({
      confirmationSensitivity: "balanced",
      automaticExecutionThreshold: 1,
      quickConfirmationThreshold: 0,
      clarificationTimeoutMs: 3000,
      accessibilityAnnouncementsPrepared: true,
      localizationReady: true,
    });
  });

  it("asks one minimal question for ambiguous battlefield objects and resumes with the selected object", () => {
    const first = soulWarden();
    const second = soulWarden("group-second-soul-warden");
    second.counters = { Shield: 1 };
    const field = normalizeField(fieldWith([first, second]));
    const entityResult = resolveEchoEntity({ field, text: "Soul Warden" });
    const decision = decideClarificationForIntent({
      field,
      intent: {
        id: "tap-soul-warden",
        kind: "tap",
        source: "voice-command",
        confidence: "low",
        payload: { primaryObjectText: "Soul Warden" },
      },
      transcript: "Tap Soul Warden.",
      entityResults: [entityResult],
      timestamp,
    });

    expect(decision.action).toBe("clarified");
    expect(decision.prompt?.question).toBe("Which Soul Warden?");
    expect(decision.prompt?.candidateLabels).toEqual([
      "Soul Warden",
      "Soul Warden",
    ]);
    expect(decision.session?.preservedContext.originalTranscript).toBe(
      "Tap Soul Warden.",
    );

    const answered = applyClarificationAnswer(decision.session!, {
      field,
      text: "second",
      timestamp: "2026-07-26T00:00:03.000Z",
    });

    expect(answered.status).toBe("resolved");
    expect(answered.resumedIntent?.entities?.[0]).toMatchObject({
      kind: "group",
      id: second.id,
    });
    expect(answered.resumePipelineStage).toBe("confidence-assignment");
  });

  it("supports chained clarification for missing quantities followed by an ambiguous target", () => {
    const first = soulWarden();
    const second = soulWarden("group-second-soul-warden");
    second.counters = { Shield: 1 };
    const field = normalizeField(fieldWith([first, second]));
    const decision = decideClarificationForIntent({
      field,
      intent: {
        id: "counter-soul-warden",
        kind: "add-counters",
        source: "voice-command",
        confidence: "low",
        payload: {
          counterName: "+1/+1",
          primaryObjectText: "Soul Warden",
        },
      },
      entityResults: [resolveEchoEntity({ field, text: "Soul Warden" })],
      timestamp,
    });

    expect(decision.issues.map((issue) => issue.type)).toEqual([
      "similar-permanent-names",
      "missing-quantity",
    ]);

    const afterTarget = applyClarificationAnswer(decision.session!, {
      field,
      text: "2",
      timestamp: "2026-07-26T00:00:01.000Z",
    });
    expect(afterTarget.status).toBe("awaiting-response");
    expect(afterTarget.prompt?.question).toBe("How many?");

    const complete = applyClarificationAnswer(afterTarget, {
      field,
      text: "three",
      timestamp: "2026-07-26T00:00:02.000Z",
    });
    expect(complete.status).toBe("resolved");
    expect(complete.resumedIntent?.payload).toMatchObject({
      quantity: 3,
      amount: 3,
    });
    expect(complete.resumedIntent?.entities?.[0]).toMatchObject({
      kind: "group",
      id: second.id,
    });
  });

  it("uses confidence to accept, confirm, clarify, or reject without arbitrary execution", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const high = decideClarificationForIntent({
      field,
      intent: {
        kind: "tap",
        source: "voice-command",
        confidence: normalizeAmbientConfidence("high", {
          source: "voice-command",
          timestamp,
          contextValid: true,
          rulesValid: true,
        }),
        entities: [{ kind: "group", id: field.groups[0].id, role: "target" }],
      },
      timestamp,
    });
    const medium = decideClarificationForIntent({
      field,
      intent: {
        kind: "tap",
        source: "voice-command",
        confidence: "medium",
        entities: [{ kind: "group", id: field.groups[0].id, role: "target" }],
      },
      timestamp,
    });
    const low = decideClarificationForIntent({
      field,
      intent: {
        kind: "pass-priority",
        source: "voice-command",
        confidence: "low",
      },
      timestamp,
    });
    const unknown = decideClarificationForIntent({
      field,
      intent: {
        kind: "pass-priority",
        source: "voice-command",
      },
      timestamp,
    });

    expect(high.action).toBe("accepted");
    expect(medium.action).toBe("confirmation-required");
    expect(medium.prompt?.question).toBe("Confirm tap?");
    expect(low.action).toBe("clarified");
    expect(unknown.action).toBe("rejected");
  });

  it("preserves listening window, ambient mode, planner, action strip, and pipeline position while paused", () => {
    const field = fieldWithContext();
    const decision = decideClarificationForIntent({
      field,
      intent: {
        id: "missing-target",
        kind: "tap",
        source: "voice-command",
        confidence: "low",
        payload: { primaryObjectText: "it" },
      },
      transcript: "Tap it.",
      pipelineStage: "entity-resolution",
      timestamp,
    });

    expect(decision.action).toBe("clarified");
    expect(decision.session?.preservedContext).toMatchObject({
      originalTranscript: "Tap it.",
      ambientMode: "preTurnPreparation",
      activeWindowKind: "counterModification",
      pipelineStage: "entity-resolution",
    });
    expect(
      decision.session?.preservedContext.plannerActionIds.length,
    ).toBeGreaterThan(0);
    expect(
      decision.session?.preservedContext.actionStripItemIds.length,
    ).toBeGreaterThan(0);
  });

  it("updates state across start, answer, timeout, cancellation, recovery, and corrupt restore", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const decision = decideClarificationForIntent({
      field,
      intent: {
        id: "confirm-attack",
        kind: "attack",
        source: "voice-command",
        confidence: "medium",
        entities: [{ kind: "group", id: field.groups[0].id, role: "target" }],
      },
      timestamp,
    });
    const started = startClarificationSession(
      createDefaultClarificationState(),
      decision,
    );
    const confirmed = applyClarificationAnswer(decision.session!, {
      field,
      text: "yes",
      timestamp: "2026-07-26T00:00:02.000Z",
    });
    const updated = updateClarificationSession(started, confirmed);

    expect(updated.activeSessionId).toBeNull();
    expect(updated.lastResolvedSessionId).toBe(confirmed.id);
    expect(confirmed.status).toBe("confirmed");

    const timedOut = timeoutClarificationSession(decision.session!, {
      timestamp: "2026-07-26T00:01:00.000Z",
    });
    const cancelled = cancelClarificationSession(decision.session!, {
      timestamp: "2026-07-26T00:00:03.000Z",
    });
    const recovered = recoverClarificationSession(decision.session!, {
      timestamp: "2026-07-26T00:00:04.000Z",
    });
    expect(timedOut.status).toBe("timed-out");
    expect(cancelled.status).toBe("cancelled");
    expect(recovered.status).toBe("recovered");

    expect(
      normalizeClarificationState({
        activeSessionId: "stale",
        sessions: [
          {
            id: "stale",
            status: "awaiting-response",
            intentKind: "tap",
            issues: [{ type: "missing-target", question: "Which permanent?" }],
          },
        ],
        diagnostics: { directBattlefieldMutation: true },
      }).diagnostics.directBattlefieldMutation,
    ).toBe(false);
  });

  it("returns clarified intents to the Ambient Event Pipeline without mutating directly", () => {
    const first = soulWarden();
    const second = soulWarden("group-second-soul-warden");
    second.counters = { Shield: 1 };
    const field = normalizeField(fieldWith([first, second]));
    const decision = decideClarificationForIntent({
      field,
      intent: {
        id: "tap-soul-warden",
        kind: "tap",
        source: "voice-command",
        confidence: "low",
        payload: { primaryObjectText: "Soul Warden" },
      },
      entityResults: [resolveEchoEntity({ field, text: "Soul Warden" })],
      timestamp,
    });
    const answered = applyClarificationAnswer(decision.session!, {
      field,
      text: "2",
      timestamp: "2026-07-26T00:00:02.000Z",
    });
    const pipeline = new AmbientEventPipeline();
    const processed = pipeline.process({
      field,
      intent: answered.resumedIntent!,
      timestamp: "2026-07-26T00:00:03.000Z",
    });

    expect(answered.directBattlefieldMutation).toBe(false);
    expect(processed.event?.resolvedEntities[0]).toMatchObject({
      groupId: second.id,
    });
    expect(processed.status).toBe("rejected");
    expect(processed.field).toEqual(field);
  });

  it("keeps accepted intents eligible for immediate pipeline preparation", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const prepared = createClarificationAwarePipelineRequest({
      field,
      intent: {
        kind: "pass-priority",
        source: "voice-command",
        confidence: "high",
      },
      timestamp,
    });

    expect(prepared.shouldProcess).toBe(true);
    expect(prepared.intent?.kind).toBe("pass-priority");
    expect(prepared.decision.action).toBe("accepted");
  });
});

function soulWarden(id?: string): PermanentGroup {
  const group = tracked(
    testCard({
      name: "Soul Warden",
      typeLine: "Creature - Human Cleric",
      oracleText: "Whenever another creature enters, you gain 1 life.",
    }),
  );
  if (id) group.id = id;
  return group;
}

function fieldWithContext() {
  const anim = tracked(animPakal());
  const base = normalizeField(fieldWith([anim]));
  const preTurnPlanner = syncPlannerWithAmbientMode(
    addPlannedAction(
      base.preTurnPlanner,
      {
        type: "counter-placement",
        title: "Put a counter on Anim Pakal",
        relatedGroupId: anim.id,
      },
      timestamp,
    ),
    "preTurnPreparation",
    timestamp,
  );
  const activeTurnActionStrip = synchronizeActionStripWithPlanner(
    base.activeTurnActionStrip,
    {
      planner: preTurnPlanner,
      ambientMode: "activeTurn",
      timestamp,
      sessionId: base.session.id,
    },
  );
  return {
    ...base,
    ambient: {
      ...base.ambient,
      currentMode: "preTurnPreparation" as const,
    },
    contextualListening: activateListeningWindow(
      base.contextualListening,
      "counterModification",
      { timestamp, source: "planner" },
    ),
    preTurnPlanner,
    activeTurnActionStrip,
  };
}
