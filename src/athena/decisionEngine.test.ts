import { describe, expect, it } from "vitest";
import { createCardGroup, createGenericGroup } from "../domain/cards";
import { normalizeField } from "../domain/field";
import type { FieldState } from "../domain/types";
import { fieldWith, testCard, tracked } from "../test/factories";
import { addPlannedAction } from "../echo/preTurnPlanner";
import {
  activeAthenaDecision,
  ATHENA_DECISION_MAX_CANDIDATES,
  athenaOptionalPreferenceAnswer,
  answerAthenaDecision,
  answerAthenaDecisionFromVoice,
  athenaDecisionStateFingerprint,
  buildAthenaDecisionCandidates,
  cancelAthenaDecision,
  clearAthenaDecisionPreference,
  cardTypeDecisionCandidates,
  colorDecisionCandidates,
  counterTypeDecisionCandidates,
  createAthenaDecisionRequest,
  createAthenaPreparedChoiceRequest,
  createDefaultAthenaDecisionQueue,
  creatureTypeDecisionCandidates,
  enqueueAthenaDecision,
  normalizeAthenaDecisionQueue,
  revalidateAthenaDecisions,
  setAthenaOptionalDecisionPreference,
  validateAthenaDecisionAnswer,
} from "./decisionEngine";
import { createAthenaManualResultForecast } from "./decisionManualResult";
import type {
  AthenaDecisionCandidate,
  AthenaDecisionRequest,
  AthenaDecisionType,
} from "./decisionEngineTypes";

const timestamp = "2026-08-20T12:00:00.000Z";

function animPakal() {
  return testCard({
    cardId: "anim-pakal",
    name: "Anim Pakal, Thousandth Moon",
    typeLine: "Legendary Creature - Human Soldier",
    oracleText: "",
    colors: ["R", "W"],
    power: "1",
    toughness: "2",
  });
}

function creature(name: string) {
  return createGenericGroup({
    kind: "Creature",
    label: name,
    cardTypes: ["Creature"],
    power: 2,
    toughness: 2,
  });
}

function fieldWithCreatures(): FieldState {
  return fieldWith([
    tracked(animPakal()),
    creature("Creature A"),
    creature("Creature B"),
  ]);
}

function request(
  field: FieldState,
  type: AthenaDecisionType,
  input: Partial<Parameters<typeof createAthenaDecisionRequest>[0]> = {},
): AthenaDecisionRequest {
  return createAthenaDecisionRequest({
    sessionId: field.session.id,
    participantId: field.multiplayer.registry.localParticipantId,
    type,
    prompt: "Choose.",
    stateFingerprint: athenaDecisionStateFingerprint(field),
    timestamp,
    ...input,
  });
}

function option(id: string, label = id): AthenaDecisionCandidate {
  return {
    id,
    label,
    semanticLabel: label,
    kind: "generic-option",
    groupId: null,
    cardId: null,
    zone: null,
    eligible: true,
    known: true,
    reason: null,
    metadata: {},
  };
}

describe("ATHENA-11 decision model and queue", () => {
  it("gives sequential choices with different candidates distinct identities", () => {
    const field = fieldWithCreatures();
    const first = request(field, "optional-replacement", {
      sourceEventId: "event-1",
      candidates: [option("replacement-a")],
      continuation: { kind: "none", step: 0 },
    });
    const second = request(field, "optional-replacement", {
      sourceEventId: "event-1",
      candidates: [option("replacement-b")],
      continuation: { kind: "none", step: 0 },
    });

    expect(first.id).not.toBe(second.id);
  });

  it("creates, queues, answers, and restores one active decision", () => {
    const field = fieldWithCreatures();
    const created = request(field, "yes-no");
    const queued = enqueueAthenaDecision(
      createDefaultAthenaDecisionQueue({
        sessionId: field.session.id,
        participantId: field.multiplayer.registry.localParticipantId,
      }),
      created,
      timestamp,
    );
    expect(activeAthenaDecision(queued)?.id).toBe(created.id);
    const answered = answerAthenaDecision(
      queued,
      created.id,
      { accepted: true, responseId: "response-one" },
      field,
      timestamp,
    );
    expect(answered.accepted).toBe(true);
    expect(answered.request.status).toBe("answered");
    expect(activeAthenaDecision(answered.queue)).toBeNull();

    const restored = normalizeAthenaDecisionQueue(answered.queue, {
      sessionId: field.session.id,
      participantId: field.multiplayer.registry.localParticipantId,
      timestamp,
    });
    expect(restored.committedResponseIds).toContain("response-one");
    expect(restored.requests[0].answer?.accepted).toBe(true);
  });

  it("does not cancel a required choice and allows a dismissible optional choice to cancel", () => {
    const field = fieldWithCreatures();
    const required = request(field, "target-selection");
    const optional = request(field, "optional-effect", {
      id: "optional",
      constraints: { required: false, dismissible: true },
    });
    let queue = enqueueAthenaDecision(
      createDefaultAthenaDecisionQueue(),
      required,
      timestamp,
    );
    expect(cancelAthenaDecision(queue, required.id, timestamp)).toBe(queue);
    queue = enqueueAthenaDecision(queue, optional, timestamp);
    const cancelled = cancelAthenaDecision(queue, optional.id, timestamp);
    expect(
      cancelled.requests.find((entry) => entry.id === optional.id)?.status,
    ).toBe("cancelled");
  });

  it("stores and clears conservative turn-scoped optional preferences", () => {
    let queue = createDefaultAthenaDecisionQueue();
    queue = setAthenaOptionalDecisionPreference(queue, {
      key: "soul-attendant",
      decisionType: "optional-effect",
      answer: "accept",
      scope: "turn",
      turnId: "turn-one",
      timestamp,
    });
    expect(
      athenaOptionalPreferenceAnswer(queue, "soul-attendant", "turn-one"),
    ).toBe(true);
    expect(
      athenaOptionalPreferenceAnswer(queue, "soul-attendant", "turn-two"),
    ).toBeNull();
    queue = clearAthenaDecisionPreference(queue, "soul-attendant", timestamp);
    expect(
      athenaOptionalPreferenceAnswer(queue, "soul-attendant", "turn-one"),
    ).toBeNull();
  });

  it("marks pending work stale after canonical session replacement", () => {
    const field = fieldWithCreatures();
    const queued = enqueueAthenaDecision(
      createDefaultAthenaDecisionQueue(),
      request(field, "yes-no"),
      timestamp,
    );
    const normalized = normalizeAthenaDecisionQueue(queued, {
      sessionId: "replacement-session",
      participantId: field.multiplayer.registry.localParticipantId,
      timestamp,
    });
    expect(normalized.requests[0].status).toBe("stale");
  });

  it("prevents duplicate touch, voice, restore, and rerender responses by stable identity", () => {
    const field = fieldWithCreatures();
    const decision = request(field, "yes-no");
    const queue = enqueueAthenaDecision(
      createDefaultAthenaDecisionQueue(),
      decision,
      timestamp,
    );
    const first = answerAthenaDecision(
      queue,
      decision.id,
      { accepted: true, responseId: "stable-response" },
      field,
      timestamp,
    );
    const duplicate = answerAthenaDecision(
      first.queue,
      decision.id,
      { accepted: true, responseId: "stable-response", channel: "voice" },
      field,
      timestamp,
    );
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.duplicatePrevented).toBe(true);
    expect(duplicate.queue.committedResponseIds).toEqual(["stable-response"]);
  });
});

describe("ATHENA-11 contextual targets", () => {
  it("indexes only eligible personal creatures and supports direct target answers", () => {
    const artifact = createGenericGroup({
      kind: "Artifact",
      label: "Sol Ring",
      cardTypes: ["Artifact"],
    });
    const field = fieldWith([...fieldWithCreatures().groups, artifact]);
    const candidates = buildAthenaDecisionCandidates(field, {
      controller: "you",
      zones: ["battlefield"],
      cardTypes: ["Creature"],
    });
    expect(candidates.map((entry) => entry.label)).toEqual([
      "Anim Pakal, Thousandth Moon",
      "Creature A",
      "Creature B",
    ]);

    const decision = request(field, "target-selection", {
      candidates,
      targetConstraints: {
        controller: "you",
        zones: ["battlefield"],
        cardTypes: ["Creature"],
      },
    });
    const target = candidates[0];
    expect(
      validateAthenaDecisionAnswer(
        decision,
        { targetGroupIds: [target.groupId!] },
        field,
        timestamp,
      ).valid,
    ).toBe(true);
  });

  it("supports exact and up-to multi-target bounds and excludes duplicate selections", () => {
    const field = fieldWithCreatures();
    const candidates = buildAthenaDecisionCandidates(field, {
      controller: "you",
      zones: ["battlefield"],
      cardTypes: ["Creature"],
      distinct: true,
    });
    const exact = request(field, "multi-target-selection", {
      candidates,
      targetConstraints: {
        controller: "you",
        zones: ["battlefield"],
        cardTypes: ["Creature"],
        distinct: true,
      },
      constraints: { exactSelections: 2 },
    });
    expect(
      validateAthenaDecisionAnswer(
        exact,
        { targetGroupIds: [candidates[0].groupId!] },
        field,
        timestamp,
      ).valid,
    ).toBe(false);
    expect(
      validateAthenaDecisionAnswer(
        exact,
        { targetGroupIds: [candidates[0].groupId!, candidates[1].groupId!] },
        field,
        timestamp,
      ).valid,
    ).toBe(true);

    const upTo = request(field, "multi-target-selection", {
      candidates,
      targetConstraints: {
        controller: "you",
        zones: ["battlefield"],
        cardTypes: ["Creature"],
      },
      constraints: { minimumSelections: 0, maximumSelections: 2 },
    });
    expect(
      validateAthenaDecisionAnswer(
        upTo,
        { targetGroupIds: [] },
        field,
        timestamp,
      ).valid,
    ).toBe(true);
  });

  it("revalidates against current state when a target leaves or transforms", () => {
    const field = fieldWithCreatures();
    const candidates = buildAthenaDecisionCandidates(field, {
      controller: "you",
      zones: ["battlefield"],
      cardTypes: ["Creature"],
    });
    const decision = request(field, "target-selection", {
      candidates,
      targetConstraints: {
        controller: "you",
        zones: ["battlefield"],
        cardTypes: ["Creature"],
      },
    });
    const targetId = candidates[0].groupId!;
    const left = normalizeField({
      ...field,
      groups: field.groups.map((group) =>
        group.id === targetId
          ? { ...group, zone: "graveyard" as const }
          : group,
      ),
    });
    const validation = validateAthenaDecisionAnswer(
      decision,
      { targetGroupIds: [targetId] },
      left,
      timestamp,
    );
    expect(validation.valid).toBe(false);
    expect(validation.stale).toBe(true);

    const queue = enqueueAthenaDecision(
      createDefaultAthenaDecisionQueue(),
      decision,
      timestamp,
    );
    const response = answerAthenaDecision(
      queue,
      decision.id,
      { targetGroupIds: [targetId], responseId: "stale-target-response" },
      left,
      timestamp,
    );
    expect(response.accepted).toBe(false);
    expect(response.request.status).toBe("active");
    expect(response.queue.activeDecisionId).toBe(decision.id);
    expect(
      response.request.candidates.some(
        (candidate) => candidate.groupId === targetId,
      ),
    ).toBe(false);
  });

  it("uses a minimal opponent placeholder without inventing an opponent board", () => {
    const field = fieldWithCreatures();
    const candidates = buildAthenaDecisionCandidates(field, {
      controller: "opponent",
      zones: ["battlefield"],
      cardTypes: ["Creature"],
      allowOpponentPlaceholder: true,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      label: "Opponent Creature",
      known: false,
      kind: "opponent-placeholder",
    });
  });
});

describe("ATHENA-11 modes, optional choices, quantities, and distributions", () => {
  it("validates single and multiple modes without allowing excess selections", () => {
    const field = fieldWithCreatures();
    const candidates = [
      option("tokens", "Create tokens"),
      option("life", "Gain life"),
    ];
    const one = request(field, "mode-selection", { candidates });
    expect(
      validateAthenaDecisionAnswer(
        one,
        { selectedOptionIds: ["tokens"], mode: "Create tokens" },
        field,
        timestamp,
      ).valid,
    ).toBe(true);
    const two = request(field, "multi-mode-selection", {
      candidates,
      constraints: { exactSelections: 2, allowRepeatedOptions: false },
    });
    expect(
      validateAthenaDecisionAnswer(
        two,
        {
          selectedOptionIds: ["tokens", "life"],
          modes: ["Create tokens", "Gain life"],
        },
        field,
        timestamp,
      ).valid,
    ).toBe(true);
    expect(
      validateAthenaDecisionAnswer(
        two,
        {
          selectedOptionIds: ["tokens", "tokens"],
          modes: ["Create tokens", "Create tokens"],
        },
        field,
        timestamp,
      ).valid,
    ).toBe(false);
    const repeatable = request(field, "multi-mode-selection", {
      candidates,
      constraints: { exactSelections: 2, allowRepeatedOptions: true },
    });
    const repeated = validateAthenaDecisionAnswer(
      repeatable,
      {
        selectedOptionIds: ["tokens", "tokens"],
        modes: ["Create tokens", "Create tokens"],
      },
      field,
      timestamp,
    );
    expect(repeated.valid).toBe(true);
    expect(repeated.normalizedAnswer?.selectedOptionIds).toEqual([
      "tokens",
      "tokens",
    ]);
  });

  it("keeps optional effects optional and resumes with a recorded no", () => {
    const field = fieldWithCreatures();
    const decision = request(field, "optional-effect");
    const queue = enqueueAthenaDecision(
      createDefaultAthenaDecisionQueue(),
      decision,
      timestamp,
    );
    const result = answerAthenaDecision(
      queue,
      decision.id,
      { accepted: false, responseId: "decline" },
      field,
      timestamp,
    );
    expect(result.accepted).toBe(true);
    expect(result.request.status).toBe("declined");
    expect(result.request.answer?.accepted).toBe(false);
  });

  it("turns a validated manual result into a structured forecast without mutating state", () => {
    const field = fieldWithCreatures();
    const decision = request(field, "manual-result");
    const queue = enqueueAthenaDecision(
      createDefaultAthenaDecisionQueue(),
      decision,
      timestamp,
    );
    const answered = answerAthenaDecision(
      queue,
      decision.id,
      {
        responseId: "manual-token-result",
        manualResult: {
          eventCategory: "token-created",
          quantity: 4,
          targetGroupIds: [],
          counterType: null,
          tokenName: "Soldier",
          tokenPower: 1,
          tokenToughness: 1,
          tokenCardTypes: ["Creature"],
          tokenSubtypes: ["Soldier"],
          tokenColors: ["White"],
          tokenTapped: false,
          tokenAttacking: false,
          originZone: null,
          destinationZone: null,
        },
      },
      field,
      timestamp,
    );
    expect(answered.accepted).toBe(true);
    expect(
      createAthenaManualResultForecast(field, answered.request, timestamp),
    ).toMatchObject({
      eventCategory: "token-created",
      quantity: 4,
      tokenDefinition: {
        name: "Soldier",
        power: 1,
        toughness: 1,
      },
    });
    expect(field.groups.some((group) => group.label === "Soldier")).toBe(false);
  });

  it.each([
    ["x-value", 0, true],
    ["x-value", 10, true],
    ["x-value", -1, false],
    ["quantity", 3, true],
    ["quantity", 11, false],
  ] as const)("validates %s value %i", (type, value, valid) => {
    const field = fieldWithCreatures();
    const decision = request(field, type, {
      constraints: { quantityMinimum: 0, quantityMaximum: 10 },
    });
    expect(
      validateAthenaDecisionAnswer(
        decision,
        { quantity: value },
        field,
        timestamp,
      ).valid,
    ).toBe(valid);
  });

  it("validates an exact counter distribution without committing counters itself", () => {
    const field = fieldWithCreatures();
    const candidates = field.groups.slice(0, 3).map((group) => ({
      ...option(group.id, group.label),
      groupId: group.id,
      kind: "battlefield-object" as const,
    }));
    const decision = request(field, "distribution", {
      candidates,
      constraints: { quantityTotal: 6 },
    });
    expect(
      validateAthenaDecisionAnswer(
        decision,
        {
          distribution: {
            [candidates[0].id]: 3,
            [candidates[1].id]: 2,
            [candidates[2].id]: 1,
          },
        },
        field,
        timestamp,
      ).valid,
    ).toBe(true);
    expect(
      validateAthenaDecisionAnswer(
        decision,
        { distribution: { [candidates[0].id]: 3 } },
        field,
        timestamp,
      ).valid,
    ).toBe(false);
    expect(
      field.groups.every((group) => (group.counters["+1/+1"] ?? 0) === 0),
    ).toBe(true);
  });
});

describe("ATHENA-11 reusable categories and zone-card decisions", () => {
  it("exposes all five game-rule colors independently of commander identity", () => {
    expect(colorDecisionCandidates().map((entry) => entry.label)).toEqual([
      "White",
      "Blue",
      "Black",
      "Red",
      "Green",
    ]);
    expect(cardTypeDecisionCandidates().map((entry) => entry.label)).toContain(
      "Kindred",
    );
  });

  it("prioritizes battlefield, recent, and deck creature types without giant persistent state", () => {
    const field = fieldWithCreatures();
    const suggestions = creatureTypeDecisionCandidates(
      field,
      ["Dragon", "Elf"],
      ["Zombie"],
    );
    expect(suggestions.map((entry) => entry.label)).toEqual(
      expect.arrayContaining(["Zombie", "Human", "Soldier", "Dragon", "Elf"]),
    );
    expect(suggestions.length).toBeLessThan(20);
  });

  it("uses existing and supported default counter names", () => {
    const field = fieldWithCreatures();
    field.groups[0].counters.Charge = 2;
    expect(
      counterTypeDecisionCandidates(field).map((entry) => entry.label),
    ).toEqual(expect.arrayContaining(["+1/+1", "Shield", "Stun", "Charge"]));
  });

  it("shows known eligible graveyard cards and an honest untracked option", () => {
    const knownCreature = createCardGroup(
      testCard({
        cardId: "grave-creature",
        name: "Grave Creature",
        typeLine: "Creature - Zombie",
        oracleText: "",
      }),
      1,
      "graveyard",
    );
    const knownSorcery = createCardGroup(
      testCard({
        cardId: "grave-sorcery",
        name: "Grave Sorcery",
        typeLine: "Sorcery",
        oracleText: "",
      }),
      1,
      "graveyard",
    );
    const unknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown graveyard card",
      zone: "graveyard",
    });
    const field = fieldWith([knownCreature, knownSorcery, unknown]);
    const candidates = buildAthenaDecisionCandidates(field, {
      controller: "you",
      zones: ["graveyard"],
      cardTypes: ["Creature"],
      allowUntrackedZoneCard: true,
    });
    expect(candidates.map((entry) => entry.label)).toEqual([
      "Grave Creature",
      "Other / Untracked Creature",
    ]);
    expect(candidates[1].known).toBe(false);
  });

  it("uses the same categorical candidate model for known and untracked exile cards", () => {
    const known = createCardGroup(
      testCard({
        cardId: "exile-creature",
        name: "Exiled Creature",
        typeLine: "Creature - Elf",
        oracleText: "",
      }),
      1,
      "exile",
    );
    const unknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown exile card",
      zone: "exile",
    });
    const field = fieldWith([known, unknown]);
    expect(
      buildAthenaDecisionCandidates(field, {
        controller: "you",
        zones: ["exile"],
        cardTypes: ["Creature"],
        allowUntrackedZoneCard: true,
      }).map((entry) => entry.label),
    ).toEqual(["Exiled Creature", "Other / Untracked Creature"]);
  });
});

describe("ATHENA-11 voice, persistence, and portability", () => {
  it("reuses prepared mode and X while requesting only an invalidated target", () => {
    const base = fieldWithCreatures();
    const planner = addPlannedAction(
      base.preTurnPlanner,
      {
        id: "prepared-choice-action",
        type: "activated-ability",
        title: "Create tokens",
        relatedGroupId: base.groups[0].id,
        quantity: 4,
        execution: {
          support: "local",
          eventCategory: "token-created",
          quantity: 4,
          mode: "Create tokens",
          targetGroupIds: [],
          requirements: ["target", "mode", "quantity"],
        },
      },
      timestamp,
    );
    const field = { ...base, preTurnPlanner: planner };
    const prepared = createAthenaPreparedChoiceRequest({
      field,
      action: planner.actions[0],
      timestamp,
    });
    expect(prepared?.type).toBe("target-selection");
    expect(prepared?.continuation).toMatchObject({
      kind: "prepared-action",
      collectedDecision: { mode: "Create tokens", quantity: 4 },
    });
  });

  it("accepts contextual target, color, yes/no, and quantity voice responses only from the enrolled speaker", () => {
    const field = fieldWithCreatures();
    const targetCandidates = buildAthenaDecisionCandidates(field, {
      controller: "you",
      zones: ["battlefield"],
      cardTypes: ["Creature"],
    });
    for (const [type, candidates, transcript] of [
      ["target-selection", targetCandidates, "Anim Pakal, Thousandth Moon"],
      ["color-selection", colorDecisionCandidates(), "Red"],
    ] as const) {
      const decision = request(field, type, { candidates });
      const queue = enqueueAthenaDecision(
        createDefaultAthenaDecisionQueue(),
        decision,
        timestamp,
      );
      expect(
        answerAthenaDecisionFromVoice(queue, field, {
          decisionId: decision.id,
          transcript,
          speakerVerified: false,
          timestamp,
        }),
      ).toBeNull();
      expect(
        answerAthenaDecisionFromVoice(queue, field, {
          decisionId: decision.id,
          transcript,
          speakerVerified: true,
          timestamp,
        })?.accepted,
      ).toBe(true);
    }

    for (const [type, transcript] of [
      ["yes-no", "yes"],
      ["quantity", "six"],
    ] as const) {
      const decision = request(field, type, {
        constraints: { quantityMinimum: 0, quantityMaximum: 10 },
      });
      const queue = enqueueAthenaDecision(
        createDefaultAthenaDecisionQueue(),
        decision,
        timestamp,
      );
      expect(
        answerAthenaDecisionFromVoice(queue, field, {
          decisionId: decision.id,
          transcript,
          speakerVerified: true,
          timestamp,
        })?.accepted,
      ).toBe(true);
    }
  });

  it("prevents a simultaneous voice and touch response from continuing twice", () => {
    const field = fieldWithCreatures();
    const decision = request(field, "color-selection", {
      candidates: colorDecisionCandidates(),
    });
    const queue = enqueueAthenaDecision(
      createDefaultAthenaDecisionQueue(),
      decision,
      timestamp,
    );
    const voice = answerAthenaDecisionFromVoice(queue, field, {
      decisionId: decision.id,
      transcript: "Red",
      speakerVerified: true,
      responseId: "race-response",
      timestamp,
    })!;
    const touch = answerAthenaDecision(
      voice.queue,
      decision.id,
      {
        selectedOptionIds: ["color:red"],
        color: "Red",
        responseId: "touch-response",
      },
      field,
      timestamp,
    );
    expect(voice.accepted).toBe(true);
    expect(touch.duplicatePrevented).toBe(true);
    expect(
      voice.queue.requests.filter((entry) => entry.status === "answered"),
    ).toHaveLength(1);
  });

  it("revalidates candidates after restoration without browser globals or closures", () => {
    const field = fieldWithCreatures();
    const candidates = buildAthenaDecisionCandidates(field, {
      controller: "you",
      zones: ["battlefield"],
      cardTypes: ["Creature"],
    });
    const decision = request(field, "target-selection", {
      candidates,
      targetConstraints: {
        controller: "you",
        zones: ["battlefield"],
        cardTypes: ["Creature"],
      },
      continuation: {
        kind: "prepared-action",
        step: 2,
        preparedActionId: "prepared-one",
        collectedDecision: { mode: "Create tokens", quantity: 4 },
      },
    });
    const queued = enqueueAthenaDecision(
      field.athena.decisions,
      decision,
      timestamp,
    );
    const persisted = JSON.parse(
      JSON.stringify({
        ...field,
        athena: { ...field.athena, decisions: queued },
      }),
    ) as FieldState;
    const restored = revalidateAthenaDecisions(persisted, timestamp);
    expect(
      activeAthenaDecision(restored.athena.decisions)?.continuation,
    ).toMatchObject({
      kind: "prepared-action",
      step: 2,
      collectedDecision: { mode: "Create tokens", quantity: 4 },
    });
    expect(serializeFunctions(restored.athena.decisions)).not.toContain(
      "function",
    );
  });

  it("keeps large grouped boards and zone stacks bounded by group identity", () => {
    const grouped = createGenericGroup({
      kind: "Creature",
      label: "Grouped Soldiers",
      cardTypes: ["Creature"],
      quantity: 1000,
      power: 1,
      toughness: 1,
    });
    const many = Array.from({ length: 250 }, (_, index) => ({
      ...creature(`Creature ${index}`),
      id: `large-creature-${index}`,
    }));
    const field = fieldWith([grouped, ...many]);
    const started = performance.now();
    const candidates = buildAthenaDecisionCandidates(field, {
      controller: "you",
      zones: ["battlefield"],
      cardTypes: ["Creature"],
    });
    const duration = performance.now() - started;
    expect(candidates).toHaveLength(251);
    expect(candidates[0].metadata.quantity).toBe(1000);
    expect(duration).toBeLessThan(250);
  });

  it("bounds persisted candidate lists on extreme object counts", () => {
    const many = Array.from({ length: 650 }, (_, index) => ({
      ...creature(`Candidate ${index}`),
      id: `bounded-candidate-${index}`,
    }));
    const field = fieldWith(many);
    const candidates = buildAthenaDecisionCandidates(field, {
      controller: "you",
      zones: ["battlefield"],
      cardTypes: ["Creature"],
    });
    const decision = request(field, "target-selection", { candidates });

    expect(candidates).toHaveLength(ATHENA_DECISION_MAX_CANDIDATES);
    expect(decision.candidates).toHaveLength(ATHENA_DECISION_MAX_CANDIDATES);
  });
});

function serializeFunctions(value: unknown): string {
  return JSON.stringify(value);
}
