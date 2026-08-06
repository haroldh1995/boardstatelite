import { describe, expect, it } from "vitest";
import { withStackKey } from "../domain/cards";
import { normalizeField } from "../domain/field";
import type { FieldState, PermanentGroup } from "../domain/types";
import {
  animPakal,
  fieldWith,
  genericCreature,
  tracked,
} from "../test/factories";
import {
  cancelCombatResolutionSession,
  captureCombatResolutionTranscript,
  createDefaultCombatResolutionSettings,
  createDefaultCombatResolutionState,
  getCombatResolutionDiagnostics,
  normalizeCombatResolutionSettings,
  normalizeCombatResolutionState,
  publishCombatResolutionToPipeline,
  recoverCombatResolutionSession,
  startCombatResolutionSession,
} from "./combatResolution";

const timestamp = "2026-08-05T12:00:00.000Z";

describe("Echo combat resolution workflow", () => {
  it("initializes local-only combat resolution defaults and strips unsafe claims", () => {
    const settings = createDefaultCombatResolutionSettings();
    const state = createDefaultCombatResolutionState();

    expect(settings).toMatchObject({
      enabled: true,
      previewRequiresConfirmation: true,
      allowMultipleOutcomes: true,
      accessibilityAnnouncementsPrepared: true,
      localizationReady: true,
      calculatesDamage: false,
      predictsBlockers: false,
      predictsOutcomes: false,
      aiStrategyRecommendations: false,
    });
    expect(state.activeSessionId).toBeNull();
    expect(state.diagnostics.directBattlefieldMutation).toBe(false);
    expect(
      normalizeCombatResolutionSettings({
        enabled: false,
        clearCombatStatusesOnCommit: true,
        calculatesDamage: true,
        predictsBlockers: true,
        predictsOutcomes: true,
        aiStrategyRecommendations: true,
        accessibilityAnnouncementsPrepared: false,
        localizationReady: false,
      }),
    ).toMatchObject({
      enabled: false,
      clearCombatStatusesOnCommit: true,
      calculatesDamage: false,
      predictsBlockers: false,
      predictsOutcomes: false,
      aiStrategyRecommendations: false,
      accessibilityAnnouncementsPrepared: true,
      localizationReady: true,
    });
  });

  it("starts a combat resolution session with a combat-resolution listening window", () => {
    const field = combatField([attacking(tracked(animPakal()))]);
    const result = startCombatResolutionSession(field, {
      timestamp,
      trigger: "voice-resolution",
    });

    expect(result.session.status).toBe("resolving");
    expect(result.window).toMatchObject({
      kind: "combatResolution",
      status: "activated",
    });
    expect(result.state.activeSessionId).toBe(result.session.id);
  });

  it("stages spoken combat outcomes without calculating blockers, damage, or outcomes", () => {
    const field = combatField([attacking(tracked(animPakal()))]);
    const result = captureCombatResolutionTranscript({
      field,
      transcript: "Anim Pakal died, take two commander damage.",
      timestamp,
    });

    expect(result.preview?.outcomes).toHaveLength(2);
    expect(result.preview?.outcomes.map((outcome) => outcome.kind)).toEqual([
      "attacker-died",
      "commander-damage-to-you",
    ]);
    expect(result.preview).toMatchObject({
      calculatesDamage: false,
      predictsBlockers: false,
      predictsOutcomes: false,
      directBattlefieldMutation: false,
      pendingClarificationCount: 0,
    });
    expect(field.groups[0].zone).toBe("battlefield");
    expect(field.player.life).toBe(40);
  });

  it("publishes a confirmed combat preview through the canonical ambient pipeline", () => {
    const anim = attacking(tracked(animPakal()));
    const field = combatField([anim]);
    const captured = captureCombatResolutionTranscript({
      field,
      transcript: "Anim Pakal died, take two commander damage.",
      timestamp,
    });
    const published = publishCombatResolutionToPipeline({
      field: { ...field, combatResolution: captured.state },
      session: captured.session,
      preview: captured.preview,
      timestamp: "2026-08-05T12:00:01.000Z",
    });

    expect(published.pipelineResult?.status).toBe("completed");
    expect(published.event?.intent.source).toBe("combat-preview");
    expect(published.event?.intent.payload).toMatchObject({
      calculatesDamage: false,
      predictsBlockers: false,
      predictsOutcomes: false,
      directBattlefieldMutation: false,
    });
    expect(published.pipelineResult?.field.groups[0]).toMatchObject({
      id: anim.id,
      zone: "graveyard",
    });
    expect(published.pipelineResult?.field.player.life).toBe(38);
    expect(
      published.pipelineResult?.field.player.counters.commanderDamage,
    ).toBe(2);
    expect(published.pipelineResult?.undo?.before.groups[0]).toMatchObject({
      id: anim.id,
      zone: "battlefield",
    });
    expect(published.state.lastCommittedSessionId).toBe(published.session.id);
  });

  it("requires clarification for unknown combat objects and prevents mutation", () => {
    const field = combatField([attacking(tracked(animPakal()))]);
    const captured = captureCombatResolutionTranscript({
      field,
      transcript: "The Dragon died.",
      timestamp,
    });
    const published = publishCombatResolutionToPipeline({
      field: { ...field, combatResolution: captured.state },
      session: captured.session,
      preview: captured.preview,
      timestamp: "2026-08-05T12:00:01.000Z",
    });

    expect(captured.preview?.pendingClarificationCount).toBe(1);
    expect(published.pipelineResult).toBeNull();
    expect(published.session.status).toBe("awaitingClarification");
    expect(field.groups[0].zone).toBe("battlefield");
  });

  it("can explicitly clear combat status markers through a confirmed preview", () => {
    const anim = attacking(tracked(animPakal()));
    const creature = blocking(genericCreature());
    const field = combatField([anim, creature]);
    const captured = captureCombatResolutionTranscript({
      field,
      transcript: "Clear combat.",
      timestamp,
    });
    const published = publishCombatResolutionToPipeline({
      field: { ...field, combatResolution: captured.state },
      session: captured.session,
      preview: captured.preview,
      timestamp: "2026-08-05T12:00:01.000Z",
    });

    expect(published.pipelineResult?.status).toBe("completed");
    expect(
      published.pipelineResult?.field.groups.some(
        (group) => group.statuses.attacking || group.statuses.blocking,
      ),
    ).toBe(false);
  });

  it("recovers active imported sessions and keeps diagnostics internal", () => {
    const field = combatField([attacking(tracked(animPakal()))]);
    const captured = captureCombatResolutionTranscript({
      field,
      transcript: "Anim Pakal survived.",
      timestamp,
    });
    const normalized = normalizeCombatResolutionState(
      {
        activeSessionId: captured.session.id,
        sessions: [captured.session],
        diagnostics: {
          calculatesDamage: true,
          predictsBlockers: true,
          predictsOutcomes: true,
          directBattlefieldMutation: true,
        },
      },
      {
        fallbackTimestamp: timestamp,
        knownGroupIds: field.groups.map((group) => group.id),
        allowActiveSession: false,
      },
    );
    const diagnostics = getCombatResolutionDiagnostics(normalized);

    expect(normalized.activeSessionId).toBeNull();
    expect(normalized.sessions[0].status).toBe("recovered");
    expect(diagnostics).toMatchObject({
      calculatesDamage: false,
      predictsBlockers: false,
      predictsOutcomes: false,
      directBattlefieldMutation: false,
    });
    expect(
      cancelCombatResolutionSession(captured.session, { timestamp }).status,
    ).toBe("cancelled");
    expect(
      recoverCombatResolutionSession(captured.session, { timestamp }).status,
    ).toBe("recovered");
  });
});

function combatField(groups: PermanentGroup[]): FieldState {
  return normalizeField(fieldWith(groups));
}

function attacking(group: PermanentGroup): PermanentGroup {
  return withStackKey({
    ...group,
    statuses: { ...group.statuses, attacking: true },
  });
}

function blocking(group: PermanentGroup): PermanentGroup {
  return withStackKey({
    ...group,
    statuses: { ...group.statuses, blocking: true },
  });
}
