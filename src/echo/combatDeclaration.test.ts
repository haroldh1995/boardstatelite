import { describe, expect, it } from "vitest";
import { createTokenGroup } from "../domain/cards";
import { normalizeField } from "../domain/field";
import type { FieldState, PermanentGroup } from "../domain/types";
import {
  animPakal,
  fieldWith,
  genericCreature,
  testCard,
  tracked,
} from "../test/factories";
import {
  applyCombatDeclarationPreviewToField,
  cancelCombatDeclarationSession,
  captureCombatDeclarationTranscript,
  createDefaultCombatDeclarationSettings,
  createDefaultCombatDeclarationState,
  getCombatDeclarationDiagnostics,
  normalizeCombatDeclarationSettings,
  normalizeCombatDeclarationState,
  publishCombatDeclarationToPipeline,
  recoverCombatDeclarationSession,
  removeCombatDeclarationAttackers,
  startCombatDeclarationSession,
} from "./combatDeclaration";

const timestamp = "2026-07-26T00:00:00.000Z";

describe("Echo combat declaration voice workflow", () => {
  it("initializes local-only combat declaration defaults and sanitizes settings", () => {
    const settings = createDefaultCombatDeclarationSettings();
    const state = createDefaultCombatDeclarationState();

    expect(settings).toMatchObject({
      enabled: true,
      requireDefendingPlayer: true,
      defaultDefenderPolicy: "clarify",
      previewRequiresConfirmation: true,
      allowGroupDeclarations: true,
      allowEverythingElse: true,
      accessibilityAnnouncementsPrepared: true,
      localizationReady: true,
    });
    expect(state.activeSessionId).toBeNull();
    expect(state.diagnostics.directBattlefieldMutation).toBe(false);
    expect(
      normalizeCombatDeclarationSettings({
        enabled: false,
        defaultDefenderPolicy: "unsafe",
        accessibilityAnnouncementsPrepared: false,
        localizationReady: false,
        developerDiagnosticsEnabled: true,
      }),
    ).toMatchObject({
      enabled: false,
      defaultDefenderPolicy: "clarify",
      accessibilityAnnouncementsPrepared: true,
      localizationReady: true,
      developerDiagnosticsEnabled: true,
    });
  });

  it("starts a combat declaration session with a combat listening window", () => {
    const field = combatField([tracked(animPakal())]);
    const result = startCombatDeclarationSession(field, {
      timestamp,
      trigger: "voice-combat",
    });

    expect(result.session.status).toBe("declaring");
    expect(result.window).toMatchObject({
      kind: "combatDeclaration",
      status: "activated",
    });
    expect(result.state.activeSessionId).toBe(result.session.id);
  });

  it("recognizes a commander attacking a named opponent without calculating combat outcome", () => {
    const field = combatField([tracked(animPakal())]);
    const result = captureCombatDeclarationTranscript({
      field,
      transcript: "Commander at Jason.",
      timestamp,
    });

    expect(result.preview?.assignments).toHaveLength(1);
    expect(result.preview?.assignments[0]).toMatchObject({
      defender: { label: "Jason" },
      clarificationRequired: false,
    });
    expect(result.preview?.assignments[0].attacker.referenceKind).toBe(
      "commander",
    );
    expect(result.preview).toMatchObject({
      calculatesDamage: false,
      predictsBlockers: false,
      predictsOutcomes: false,
      directBattlefieldMutation: false,
    });
  });

  it("tracks partial token attackers by splitting stacks through the canonical pipeline", () => {
    const soldiers = createTokenGroup({
      name: "Soldier",
      quantity: 4,
      power: 1,
      toughness: 1,
      subtypes: ["Soldier"],
    });
    const field = combatField([soldiers]);
    const declared = captureCombatDeclarationTranscript({
      field,
      transcript: "Attack with both Soldiers at Sarah.",
      timestamp,
    });
    const published = publishCombatDeclarationToPipeline({
      field: {
        ...field,
        combatDeclaration: declared.state,
      },
      session: declared.session,
      preview: declared.preview,
      timestamp: "2026-07-26T00:00:01.000Z",
    });

    expect(declared.preview?.assignments[0].attacker.requestedQuantity).toBe(2);
    expect(published.pipelineResult?.status).toBe("completed");
    expect(published.event?.intent.kind).toBe("attack");
    expect(published.event?.intent.payload).toMatchObject({
      calculatesDamage: false,
      predictsBlockers: false,
      predictsOutcomes: false,
    });
    const attacking = published.pipelineResult!.field.groups.filter(
      (group) => group.statuses.attacking,
    );
    const stayingBack = published.pipelineResult!.field.groups.filter(
      (group) => !group.statuses.attacking,
    );
    expect(attacking).toHaveLength(1);
    expect(attacking[0]).toMatchObject({ label: "Soldier", quantity: 2 });
    expect(stayingBack[0]).toMatchObject({ label: "Soldier", quantity: 2 });
    expect(published.pipelineResult?.undo?.before.groups).toEqual(field.groups);
  });

  it("supports multiplayer attack assignments and everything-else group references", () => {
    const anim = tracked(animPakal());
    const dragon = tracked(dragonCard());
    const soldiers = createTokenGroup({
      name: "Soldier",
      quantity: 3,
      power: 1,
      toughness: 1,
      subtypes: ["Soldier"],
    });
    const field = combatField([anim, dragon, soldiers]);
    const first = captureCombatDeclarationTranscript({
      field,
      transcript: "Commander attacks Jason.",
      timestamp,
    });
    const second = captureCombatDeclarationTranscript({
      field,
      session: first.session,
      transcript: "Everything else attacks Mike.",
      timestamp: "2026-07-26T00:00:02.000Z",
    });

    expect(
      second.preview?.assignments.map((entry) => entry.defender?.label),
    ).toEqual(["Jason", "Mike", "Mike"]);
    expect(
      second.preview?.assignments.map((entry) => entry.attacker.label),
    ).toEqual(["Anim Pakal, Thousandth Moon", "Shivan Dragon", "Soldier"]);
  });

  it("recognizes creature type and natural shorthand declarations", () => {
    const dragon = tracked(dragonCard());
    const soldiers = createTokenGroup({
      name: "Soldier",
      quantity: 3,
      power: 1,
      toughness: 1,
      subtypes: ["Soldier"],
    });
    const field = combatField([dragon, soldiers]);

    expect(
      captureCombatDeclarationTranscript({
        field,
        transcript: "Dragon at Sarah.",
        timestamp,
      }).preview?.assignments[0],
    ).toMatchObject({
      attacker: { label: "Shivan Dragon" },
      defender: { label: "Sarah" },
    });
    expect(
      captureCombatDeclarationTranscript({
        field,
        transcript: "Three Soldiers attack Harold.",
        timestamp,
      }).preview?.assignments[0],
    ).toMatchObject({
      attacker: { label: "Soldier", requestedQuantity: 3 },
      defender: { label: "Harold" },
    });
  });

  it("uses clarification when a defending player or attacker is ambiguous", () => {
    const first = soulWarden();
    const second = soulWarden("group-second-soul-warden");
    second.counters = { Shield: 1 };
    const field = combatField([first, second]);

    const noDefender = captureCombatDeclarationTranscript({
      field,
      transcript: "Swing with everything.",
      timestamp,
    });
    expect(noDefender.preview?.clarificationRequests[0]).toMatchObject({
      question: "Which opponent?",
      type: "defender",
    });

    const ambiguous = captureCombatDeclarationTranscript({
      field,
      transcript: "Soul Warden at Mike.",
      timestamp,
    });
    expect(ambiguous.preview?.clarificationRequests[0]?.question).toBe(
      "Which Soul Warden?",
    );
    expect(
      ambiguous.preview?.clarificationRequests[0]?.frameworkDecision?.action,
    ).toBe("clarified");
  });

  it("edits declared attackers and preserves previous declaration states for undo", () => {
    const dragon = tracked(dragonCard());
    const anim = tracked(animPakal());
    const field = combatField([dragon, anim]);
    const declared = captureCombatDeclarationTranscript({
      field,
      transcript: "Dragon at Sarah.",
      timestamp,
    });
    const withCommander = captureCombatDeclarationTranscript({
      field,
      session: declared.session,
      transcript: "Commander at Mike.",
      timestamp: "2026-07-26T00:00:01.000Z",
    });
    const edited = removeCombatDeclarationAttackers({
      field,
      session: withCommander.session,
      transcript: "No, remove the Dragon.",
      timestamp: "2026-07-26T00:00:02.000Z",
    });

    expect(edited.assignments).toHaveLength(1);
    expect(edited.assignments[0].attacker.label).toContain("Anim Pakal");

    const published = publishCombatDeclarationToPipeline({
      field: {
        ...field,
        combatDeclaration: withCommander.state,
      },
      session: edited,
      preview: edited.preview,
      timestamp: "2026-07-26T00:00:03.000Z",
    });
    expect(published.pipelineResult?.status).toBe("completed");
    expect(published.pipelineResult?.undo?.before).toMatchObject({
      groups: field.groups,
    });
    expect(
      published.pipelineResult?.field.groups.find(
        (group) => group.label === "Shivan Dragon",
      )?.statuses.attacking,
    ).toBe(false);
  });

  it("handles cancellation, recovery, diagnostics, and corrupt persisted state safely", () => {
    const field = combatField([genericCreature()]);
    const session = startCombatDeclarationSession(field, { timestamp }).session;
    const cancelled = cancelCombatDeclarationSession(session, {
      timestamp: "2026-07-26T00:00:01.000Z",
    });
    const recovered = recoverCombatDeclarationSession(session, {
      timestamp: "2026-07-26T00:00:02.000Z",
    });
    const normalized = normalizeCombatDeclarationState({
      activeSessionId: "bad",
      sessions: [
        {
          id: "bad",
          status: "declaring",
          assignments: [
            {
              attacker: {
                groupId: "missing",
                label: "Missing",
              },
            },
          ],
          directBattlefieldMutation: true,
        },
      ],
      diagnostics: { directBattlefieldMutation: true },
    });

    expect(cancelled.status).toBe("cancelled");
    expect(recovered.status).toBe("recovered");
    expect(normalized.activeSessionId).toBeNull();
    expect(normalized.sessions).toHaveLength(1);
    expect(normalized.sessions[0].status).toBe("recovered");
    expect(getCombatDeclarationDiagnostics(normalized)).toMatchObject({
      directBattlefieldMutation: false,
    });
  });

  it("can apply a confirmed preview without blocker, damage, prediction, or AI behavior", () => {
    const field = combatField([tracked(animPakal())]);
    const declared = captureCombatDeclarationTranscript({
      field,
      transcript: "Attack with Anim Pakal at Jason.",
      timestamp,
    });
    const next = applyCombatDeclarationPreviewToField(
      {
        ...field,
        combatDeclaration: declared.state,
      },
      declared.preview!,
      "event-test",
      "2026-07-26T00:00:01.000Z",
      declared.session.id,
    );

    expect(next.groups[0].statuses.attacking).toBe(true);
    expect(next.groups[0].statuses.blocking).toBe(false);
    expect(next.player.life).toBe(field.player.life);
    expect(declared.preview).toMatchObject({
      calculatesDamage: false,
      predictsBlockers: false,
      predictsOutcomes: false,
    });
  });
});

function combatField(groups: PermanentGroup[]): FieldState {
  const base = normalizeField(fieldWith(groups));
  return normalizeField({
    ...base,
    ambient: {
      ...base.ambient,
      currentMode: "combat",
      context: {
        ...base.ambient.context,
        focusedAction: "combatDeclaration",
        observedTurn: {
          activeController: "you",
          phase: "combat",
          updatedAt: timestamp,
        },
      },
    },
  });
}

function dragonCard() {
  return testCard({
    name: "Shivan Dragon",
    typeLine: "Creature - Dragon",
    oracleText: "Flying",
    keywords: ["Flying"],
    power: "5",
    toughness: "5",
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
