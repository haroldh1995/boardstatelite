import { describe, expect, it } from "vitest";
import { createTokenGroup } from "../domain/cards";
import { normalizeField } from "../domain/field";
import type { FieldState, PermanentGroup } from "../domain/types";
import {
  animPakal,
  fieldWith,
  testCard,
  tracked,
  withCounters,
} from "../test/factories";
import {
  applyVoiceBattlefieldActionToField,
  cancelVoiceBattlefieldActionSession,
  captureVoiceBattlefieldActionTranscript,
  createDefaultVoiceBattlefieldActionSettings,
  createDefaultVoiceBattlefieldActionState,
  getVoiceBattlefieldActionDiagnostics,
  normalizeVoiceBattlefieldActionSettings,
  normalizeVoiceBattlefieldActionState,
  publishVoiceBattlefieldActionsToPipeline,
  recoverVoiceBattlefieldActionSession,
  reviseVoiceBattlefieldActions,
  startVoiceBattlefieldActionSession,
} from "./voiceBattlefieldActions";

const timestamp = "2026-07-26T00:00:00.000Z";

describe("Echo voice battlefield action framework", () => {
  it("initializes local-only defaults and sanitizes settings", () => {
    const settings = createDefaultVoiceBattlefieldActionSettings();
    const state = createDefaultVoiceBattlefieldActionState();

    expect(settings).toMatchObject({
      enabled: true,
      previewRequiresConfirmation: true,
      allowMultipleActions: true,
      triggerRecognitionEnabled: true,
      accessibilityAnnouncementsPrepared: true,
      localizationReady: true,
    });
    expect(state.activeSessionId).toBeNull();
    expect(state.diagnostics.directBattlefieldMutation).toBe(false);
    expect(
      normalizeVoiceBattlefieldActionSettings({
        enabled: false,
        defaultTokenPower: -4,
        defaultTokenToughness: 999,
        accessibilityAnnouncementsPrepared: false,
        localizationReady: false,
        developerDiagnosticsEnabled: true,
      }),
    ).toMatchObject({
      enabled: false,
      defaultTokenPower: 0,
      defaultTokenToughness: 99,
      accessibilityAnnouncementsPrepared: true,
      localizationReady: true,
      developerDiagnosticsEnabled: true,
    });
  });

  it("stages and publishes multiple life, token, and counter actions through the pipeline", () => {
    const anim = tracked(animPakal());
    const field = actionField([anim]);
    const captured = captureVoiceBattlefieldActionTranscript({
      field,
      transcript:
        "I gained three life, create two Treasures, then put a +1/+1 counter on Anim Pakal.",
      timestamp,
    });

    expect(captured.preview?.summary).toEqual([
      "Gain 3 life.",
      "Create 2 Treasure token(s).",
      "Add 1 +1/+1 counter(s) to Anim Pakal, Thousandth Moon.",
    ]);
    expect(captured.preview?.confirmedActionCount).toBe(3);
    expect(captured.preview?.pendingClarificationCount).toBe(0);

    const published = publishVoiceBattlefieldActionsToPipeline({
      field: {
        ...field,
        voiceBattlefieldActions: captured.state,
      },
      session: captured.session,
      preview: captured.preview,
      timestamp: "2026-07-26T00:00:01.000Z",
    });

    expect(published.pipelineResults).toHaveLength(3);
    expect(
      published.pipelineResults.every((entry) => entry.status === "completed"),
    ).toBe(true);
    const finalField = published.pipelineResults.at(-1)!.field;
    expect(finalField.player.life).toBe(43);
    expect(
      finalField.groups.find((group) => group.label === "Treasure")?.quantity,
    ).toBe(2);
    expect(
      finalField.groups.find((group) => group.label.startsWith("Anim Pakal"))
        ?.counters["+1/+1"],
    ).toBe(1);
    expect(published.pipelineResults[0].undo?.before.player).toEqual(
      field.player,
    );
    expect(published.pipelineResults[0].undo?.before.groups).toEqual(
      field.groups,
    );
    expect(published.session.status).toBe("committed");
  });

  it("recognizes trigger announcements as structured manual events without resolving rules", () => {
    const field = actionField([
      tracked(
        testCard({
          name: "Cathars' Crusade",
          typeLine: "Enchantment",
          oracleText:
            "Whenever a creature enters the battlefield under your control, put a +1/+1 counter on each creature you control.",
        }),
      ),
      tracked(animPakal()),
    ]);
    const captured = captureVoiceBattlefieldActionTranscript({
      field,
      transcript: "Cathars' Crusade trigger.",
      timestamp,
    });
    const published = publishVoiceBattlefieldActionsToPipeline({
      field: { ...field, voiceBattlefieldActions: captured.state },
      session: captured.session,
      preview: captured.preview,
      timestamp: "2026-07-26T00:00:01.000Z",
    });

    expect(captured.preview?.actions[0]).toMatchObject({
      kind: "trigger-announcement",
      triggerName: "Cathars Crusade",
    });
    expect(
      published.pipelineResults[0].event?.result.generatedGameEventIds,
    ).toHaveLength(1);
    expect(published.pipelineResults[0].historyEntry?.summary[0]).toContain(
      "Announce Cathars Crusade",
    );
    expect(
      published.pipelineResults[0].field.groups.find((group) =>
        group.label.startsWith("Anim Pakal"),
      )?.counters["+1/+1"],
    ).toBeUndefined();
  });

  it("handles tap, untap, zone movement, sacrifice, and commander damage actions", () => {
    const solRing = tracked(
      testCard({
        name: "Sol Ring",
        typeLine: "Artifact",
        oracleText: "{T}: Add {C}{C}.",
      }),
    );
    const treasure = createTokenGroup({
      name: "Treasure",
      quantity: 2,
      power: 0,
      toughness: 0,
      subtypes: ["Treasure"],
    });
    const field = actionField([solRing, treasure]);
    const captured = captureVoiceBattlefieldActionTranscript({
      field,
      transcript:
        "Tap Sol Ring, untap everything, sacrifice a Treasure, take two commander damage.",
      timestamp,
    });
    const published = publishVoiceBattlefieldActionsToPipeline({
      field: { ...field, voiceBattlefieldActions: captured.state },
      session: captured.session,
      preview: captured.preview,
      timestamp: "2026-07-26T00:00:01.000Z",
    });
    const finalField = published.pipelineResults.at(-1)!.field;

    expect(published.pipelineResults).toHaveLength(4);
    expect(
      finalField.groups.find((group) => group.label === "Sol Ring")?.statuses
        .tapped,
    ).toBe(false);
    expect(
      finalField.groups.find((group) => group.label === "Treasure")?.quantity,
    ).toBe(1);
    expect(finalField.player.life).toBe(38);
    expect(finalField.player.counters.commanderDamage).toBe(2);
  });

  it("uses clarification for ambiguous targets and supports staged correction", () => {
    const first = soulWarden();
    const second = soulWarden("second-soul-warden");
    second.counters = { Shield: 1 };
    const field = actionField([first, second]);

    const ambiguous = captureVoiceBattlefieldActionTranscript({
      field,
      transcript: "Tap Soul Warden.",
      timestamp,
    });
    expect(ambiguous.preview?.clarificationRequests[0]?.question).toBe(
      "Which Soul Warden?",
    );

    const tokens = captureVoiceBattlefieldActionTranscript({
      field,
      transcript: "Create two Treasures.",
      timestamp,
    });
    const revised = reviseVoiceBattlefieldActions({
      field,
      session: tokens.session,
      transcript: "No, only one Treasure.",
      timestamp: "2026-07-26T00:00:01.000Z",
    });

    expect(revised.preview?.actions[0]).toMatchObject({
      kind: "token-create",
      quantity: 1,
    });
  });

  it("removes counters, creates placeholders for reported entries, and recovers corrupt state safely", () => {
    const anim = withCounters(tracked(animPakal()), { Shield: 1 });
    const field = actionField([anim]);
    const captured = captureVoiceBattlefieldActionTranscript({
      field,
      transcript: "Remove a shield counter. My commander enters.",
      timestamp,
    });
    const published = publishVoiceBattlefieldActionsToPipeline({
      field: { ...field, voiceBattlefieldActions: captured.state },
      session: captured.session,
      preview: captured.preview,
      timestamp: "2026-07-26T00:00:01.000Z",
    });
    const finalField = published.pipelineResults.at(-1)!.field;

    expect(
      finalField.groups.find((group) => group.id === anim.id)?.counters.Shield,
    ).toBeUndefined();
    expect(captured.preview?.summary).toContain(
      "Anim Pakal, Thousandth Moon enters.",
    );

    const session = startVoiceBattlefieldActionSession(field, {
      timestamp,
    }).session;
    expect(
      cancelVoiceBattlefieldActionSession(session, {
        timestamp: "2026-07-26T00:00:02.000Z",
      }).status,
    ).toBe("cancelled");
    expect(
      recoverVoiceBattlefieldActionSession(session, {
        timestamp: "2026-07-26T00:00:03.000Z",
      }).status,
    ).toBe("recovered");
    const normalized = normalizeVoiceBattlefieldActionState({
      activeSessionId: "bad",
      sessions: [{ id: "bad", status: "staging", actions: [] }],
      diagnostics: { directBattlefieldMutation: true },
    });
    expect(normalized.activeSessionId).toBeNull();
    expect(normalized.sessions[0].status).toBe("recovered");
    expect(getVoiceBattlefieldActionDiagnostics(normalized)).toMatchObject({
      directBattlefieldMutation: false,
    });
  });

  it("can apply a single staged action through the shared mutation helper", () => {
    const field = actionField([tracked(animPakal())]);
    const captured = captureVoiceBattlefieldActionTranscript({
      field,
      transcript: "Gain three life.",
      timestamp,
    });
    const result = applyVoiceBattlefieldActionToField({
      field,
      action: captured.preview!.actions[0],
      timestamp,
    });

    expect(result.field.player.life).toBe(43);
    expect(result.summary).toEqual(["Life gain: 40 to 43."]);
  });
});

function actionField(groups: PermanentGroup[]): FieldState {
  const base = normalizeField(fieldWith(groups));
  return normalizeField({
    ...base,
    ambient: {
      ...base.ambient,
      currentMode: "activeTurn",
      context: {
        ...base.ambient.context,
        focusedAction: "none",
        observedTurn: {
          activeController: "you",
          phase: "precombatMain",
          updatedAt: timestamp,
        },
      },
    },
  });
}

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
