import { beforeEach, describe, expect, it } from "vitest";
import {
  createCardGroup,
  createGenericGroup,
  recalculateStats,
  withStackKey,
} from "../domain/cards";
import {
  calculateTotals,
  createDefaultField,
  normalizeField,
} from "../domain/field";
import { getZoneCompositionSnapshot } from "../domain/zoneComposition";
import { useFieldStore } from "../state/useFieldStore";
import { testCard } from "../test/factories";
import { applyAthenaDerivedStateToField } from "./derivedState";
import {
  athenaDecisionStateFingerprint,
  buildAthenaDecisionCandidates,
  createAthenaDecisionRequest,
  enqueueAthenaDecision,
} from "./decisionEngine";
import {
  applyAthenaReconciliation,
  canSafelyProcessMissedRealGameAction,
  createAthenaReconciliationRequest,
  markAthenaReconciliationLifecycle,
  normalizeAthenaReconciliationState,
} from "./reconciliation";
import type { AthenaReconciliationRepair } from "./reconciliationTypes";

const timestamp = "2026-08-20T12:00:00.000Z";

function fieldWithGroups(groups: ReturnType<typeof createGenericGroup>[]) {
  return normalizeField({
    ...createDefaultField(),
    groups,
    updatedAt: timestamp,
  });
}

function request(
  field: ReturnType<typeof createDefaultField>,
  repairs: AthenaReconciliationRepair[],
  atomic = true,
) {
  return createAthenaReconciliationRequest({
    field,
    repairs,
    source: "catch-me-up",
    level: repairs.length > 1 ? "catch-me-up" : "quick-correction",
    atomic,
    timestamp,
    provenance: "test",
  });
}

describe("ATHENA-13 physical game reconciliation", () => {
  beforeEach(() => {
    useFieldStore.setState({
      field: createDefaultField(),
      modal: null,
      lastResult: null,
      undoStack: [],
      redoStack: [],
      hydrated: true,
      startupVisible: false,
    });
  });

  it("applies a Catch Me Up batch as Correction Only with no gameplay pipeline output", () => {
    const land = createGenericGroup({ kind: "Land", quantity: 8 });
    const treasure = createGenericGroup({
      kind: "Token",
      label: "Treasure",
      quantity: 4,
      cardTypes: ["Artifact"],
      subtypes: ["Treasure"],
      token: true,
    });
    const graveyard = createGenericGroup({
      kind: "Custom",
      label: "Unaccounted graveyard cards",
      quantity: 12,
      zone: "graveyard",
    });
    const field = normalizeField({
      ...fieldWithGroups([land, treasure, graveyard]),
      player: { ...createDefaultField().player, life: 31 },
    });
    const result = applyAthenaReconciliation(
      field,
      request(field, [
        { id: "life", kind: "set-life", value: 28 },
        { id: "lands", kind: "set-relevant-total", key: "lands", value: 9 },
        {
          id: "treasures",
          kind: "set-group-quantity",
          groupId: treasure.id,
          value: 6,
        },
        {
          id: "graveyard",
          kind: "set-zone-composition",
          zone: "graveyard",
          physicalTotal: 13,
        },
      ]),
    );

    expect(result.ok).toBe(true);
    expect(result.generatedGameEvents).toEqual([]);
    expect(result.record).toMatchObject({
      correctionOnly: true,
      gameplayEventsGenerated: 0,
      replacementEffectsApplied: false,
      triggersGenerated: 0,
      discrepancyCount: 4,
    });
    expect(result.field.player.life).toBe(28);
    expect(calculateTotals(result.field.groups)).toMatchObject({
      lands: 9,
      treasureTokens: 6,
      cardsInGraveyard: 13,
    });
  });

  it("corrects token stacks and counters without token-entry, death, or counter-placement events", () => {
    const swarm = createGenericGroup({
      kind: "Token",
      label: "Scute Swarm",
      quantity: 32,
      power: 1,
      toughness: 1,
      token: true,
    });
    const hydra = withStackKey(
      recalculateStats({
        ...createGenericGroup({
          kind: "Creature",
          label: "Mossborn Hydra",
          power: 0,
          toughness: 0,
        }),
        counters: { "+1/+1": 8 },
      }),
    );
    const field = fieldWithGroups([swarm, hydra]);
    const result = applyAthenaReconciliation(
      field,
      request(field, [
        {
          id: "swarm",
          kind: "set-group-quantity",
          groupId: swarm.id,
          value: 40,
        },
        {
          id: "hydra",
          kind: "set-counter",
          groupId: hydra.id,
          counter: "+1/+1",
          value: 12,
        },
      ]),
    );

    expect(
      result.field.groups.find((group) => group.id === swarm.id)?.quantity,
    ).toBe(40);
    expect(
      result.field.groups.find((group) => group.id === hydra.id),
    ).toMatchObject({
      counters: { "+1/+1": 12 },
      pt: { currentPower: 12, currentToughness: 12 },
    });
    expect(result.generatedGameEvents).toHaveLength(0);
    expect(
      result.discrepancies.map((entry) => entry.semanticDescription),
    ).toEqual([
      "Scute Swarm quantity corrected from 32 to 40.",
      "+1/+1 counters on Mossborn Hydra corrected from 8 to 12.",
    ]);
  });

  it("adds and removes current card representations without cast, ETB, LTB, death, or sacrifice history", () => {
    const soulWarden = testCard({
      name: "Soul Warden",
      typeLine: "Creature - Human Cleric",
      oracleText:
        "Whenever another creature enters the battlefield, you gain 1 life.",
      colors: ["W"],
      power: "1",
      toughness: "1",
    });
    const field = createDefaultField();
    const added = applyAthenaReconciliation(
      field,
      request(field, [
        {
          id: "soul-warden",
          kind: "add-card-already-present",
          identity: soulWarden,
          quantity: 1,
          zone: "battlefield",
        },
      ]),
    );
    const group = added.field.groups.find(
      (entry) => entry.identity?.cardId === soulWarden.cardId,
    )!;
    const removed = applyAthenaReconciliation(
      added.field,
      request(added.field, [
        {
          id: "remove",
          kind: "remove-object-representation",
          groupId: group.id,
        },
      ]),
    );

    expect(added.generatedGameEvents).toEqual([]);
    expect(added.field.groups).toContainEqual(
      expect.objectContaining({ label: "Soul Warden", trackingEnabled: true }),
    );
    expect(removed.generatedGameEvents).toEqual([]);
    expect(removed.field.groups.some((entry) => entry.id === group.id)).toBe(
      false,
    );
  });

  it("repairs wrong identity while preserving object lineage and compatible current modifiers", () => {
    const arcane = createCardGroup(
      testCard({
        name: "Arcane Signet",
        typeLine: "Artifact",
        oracleText:
          "{T}: Add one mana of any color in your commander's color identity.",
      }),
    );
    const modified = withStackKey({
      ...arcane,
      counters: { Charge: 2 },
      statuses: { ...arcane.statuses, tapped: true },
      trackingEnabled: false,
    });
    const solRing = testCard({
      name: "Sol Ring",
      typeLine: "Artifact",
      oracleText: "{T}: Add {C}{C}.",
    });
    const field = fieldWithGroups([modified]);
    const result = applyAthenaReconciliation(
      field,
      request(field, [
        {
          id: "identity",
          kind: "replace-identity",
          groupId: modified.id,
          identity: solRing,
        },
      ]),
    );
    const corrected = result.field.groups[0];

    expect(corrected).toMatchObject({
      id: modified.id,
      label: "Sol Ring",
      counters: { Charge: 2 },
      statuses: { tapped: true },
      trackingEnabled: false,
    });
    expect(result.generatedGameEvents).toEqual([]);
  });

  it("repairs attachments and current face without fabricating attach or transform events", () => {
    const creature = createGenericGroup({
      kind: "Creature",
      label: "Creature",
    });
    const other = createGenericGroup({ kind: "Creature", label: "Other" });
    const aura = createGenericGroup({ kind: "Enchantment", label: "Aura" });
    const field = fieldWithGroups([
      creature,
      other,
      withStackKey({ ...aura, attachedTo: creature.id }),
    ]);
    const face = testCard({
      name: "Night Face",
      typeLine: "Creature - Werewolf",
      oracleText: "",
      power: "4",
      toughness: "4",
    });
    const result = applyAthenaReconciliation(
      field,
      request(field, [
        {
          id: "attachment",
          kind: "set-attachment",
          attachmentId: aura.id,
          attachedTo: other.id,
        },
        {
          id: "face",
          kind: "set-current-face",
          groupId: creature.id,
          identity: face,
          transformed: true,
        },
      ]),
    );

    expect(
      result.field.groups.find((group) => group.id === aura.id)?.attachedTo,
    ).toBe(other.id);
    expect(
      result.field.groups.find((group) => group.id === other.id)?.attachments,
    ).toContain(aura.id);
    expect(
      result.field.groups.find((group) => group.id === creature.id),
    ).toMatchObject({
      id: creature.id,
      label: "Night Face",
      statuses: { transformed: true },
    });
    expect(result.generatedGameEvents).toEqual([]);
  });

  it("repairs base power and toughness overrides without changing printed identity", () => {
    const card = testCard({
      name: "Printed Creature",
      typeLine: "Creature",
      oracleText: "",
      power: "2",
      toughness: "3",
    });
    const group = createCardGroup(card);
    const field = fieldWithGroups([group]);
    const result = applyAthenaReconciliation(
      field,
      request(field, [
        {
          id: "base-pt",
          kind: "set-base-power-toughness",
          groupId: group.id,
          power: 5,
          toughness: 6,
        },
      ]),
    );

    expect(result.field.groups[0]).toMatchObject({
      identity: { cardId: card.cardId, power: "2", toughness: "3" },
      pt: {
        printedPower: 2,
        printedToughness: 3,
        basePower: 5,
        baseToughness: 6,
        currentPower: 5,
        currentToughness: 6,
      },
    });
    expect(result.generatedGameEvents).toEqual([]);
  });

  it("repairs overlapping graveyard and exile composition while preserving unknown separately from Colorless", () => {
    const graveUnknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown graveyard cards",
      quantity: 14,
      zone: "graveyard",
    });
    const exileUnknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown exile cards",
      quantity: 5,
      zone: "exile",
    });
    const field = fieldWithGroups([graveUnknown, exileUnknown]);
    const result = applyAthenaReconciliation(
      field,
      request(field, [
        {
          id: "grave",
          kind: "set-zone-composition",
          zone: "graveyard",
          physicalTotal: 15,
          categoryTotals: {
            creature: 8,
            artifact: 3,
            legendary: 2,
            red: 5,
            green: 4,
            multicolor: 2,
            colorless: 1,
            "subtype:dragon": 1,
          },
        },
        {
          id: "exile",
          kind: "set-zone-composition",
          zone: "exile",
          physicalTotal: 6,
          categoryTotals: { artifact: 4, colorless: 2 },
        },
      ]),
    );
    const graveyard = getZoneCompositionSnapshot(result.field, "graveyard");
    const exile = getZoneCompositionSnapshot(result.field, "exile");

    expect(graveyard.physicalTotal).toBe(15);
    expect(graveyard.categoryTotals).toMatchObject({
      creature: 8,
      artifact: 3,
      legendary: 2,
      red: 5,
      green: 4,
      multicolor: 2,
      colorless: 1,
      "subtype:dragon": 1,
    });
    expect(
      Object.values(graveyard.categoryTotals).reduce<number>(
        (sum, value) => sum + (value ?? 0),
        0,
      ),
    ).toBeGreaterThan(graveyard.physicalTotal);
    expect(graveyard.unaccountedPhysicalCards).toBe(15);
    expect(exile).toMatchObject({
      physicalTotal: 6,
      unaccountedPhysicalCards: 6,
    });
    expect(exile.categoryTotals).toMatchObject({ artifact: 4, colorless: 2 });
  });

  it("reconciles an unknown zone card identity without changing physical total or creating zone history", () => {
    const unknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown graveyard card",
      quantity: 1,
      zone: "graveyard",
    });
    const card = testCard({
      name: "Known Dragon",
      typeLine: "Legendary Artifact Creature - Dragon",
      oracleText: "",
      colors: ["R", "G"],
      colorIdentity: ["R", "G"],
      power: "5",
      toughness: "5",
    });
    const field = fieldWithGroups([unknown]);
    const result = applyAthenaReconciliation(
      field,
      request(field, [
        {
          id: "identify",
          kind: "replace-identity",
          groupId: unknown.id,
          identity: card,
        },
      ]),
    );
    const snapshot = getZoneCompositionSnapshot(result.field, "graveyard");

    expect(snapshot.physicalTotal).toBe(1);
    expect(snapshot.knownPhysicalCards).toBe(1);
    expect(snapshot.categoryTotals).toMatchObject({
      creature: 1,
      artifact: 1,
      legendary: 1,
      red: 1,
      green: 1,
      multicolor: 1,
      "subtype:dragon": 1,
    });
    expect(result.generatedGameEvents).toEqual([]);
    expect(result.field.groups[0].id).toBe(unknown.id);
  });

  it("recalculates graveyard-dependent static power after category correction without Activate Field", () => {
    const wurm = createCardGroup(
      testCard({
        name: "Boneyard Wurm",
        typeLine: "Creature - Wurm",
        oracleText:
          "Boneyard Wurm's power and toughness are each equal to the number of creature cards in your graveyard.",
        colors: ["G"],
        power: "*",
        toughness: "*",
      }),
    );
    const unknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown graveyard cards",
      quantity: 15,
      zone: "graveyard",
    });
    let field = fieldWithGroups([wurm, unknown]);
    field = applyAthenaReconciliation(
      field,
      request(field, [
        {
          id: "creatures-seven",
          kind: "set-zone-composition",
          zone: "graveyard",
          categoryTotals: { creature: 7 },
        },
      ]),
    ).field;
    field = applyAthenaDerivedStateToField(field, { timestamp }).field;
    expect(
      field.groups.find((group) => group.id === wurm.id)?.pt.currentPower,
    ).toBe(7);

    field = applyAthenaReconciliation(
      field,
      request(field, [
        {
          id: "creatures-eight",
          kind: "set-zone-composition",
          zone: "graveyard",
          categoryTotals: { creature: 8 },
        },
      ]),
    ).field;
    field = applyAthenaDerivedStateToField(field, { timestamp }).field;
    expect(
      field.groups.find((group) => group.id === wurm.id)?.pt.currentPower,
    ).toBe(8);
  });

  it("rejects an invalid atomic batch without partially applying valid repairs", () => {
    const group = createGenericGroup({
      kind: "Token",
      label: "Treasure",
      quantity: 4,
    });
    const field = fieldWithGroups([group]);
    const result = applyAthenaReconciliation(
      field,
      request(field, [
        { id: "life", kind: "set-life", value: 28 },
        {
          id: "invalid",
          kind: "set-group-quantity",
          groupId: "missing",
          value: 2,
        },
      ]),
    );

    expect(result.ok).toBe(false);
    expect(result.field.player.life).toBe(field.player.life);
    expect(result.field.groups).toEqual(field.groups);
    expect(result.state.diagnostics.recoveryFailures).toBe(1);
  });

  it("applies valid independent repairs and reports rejected ones for a non-atomic batch", () => {
    const field = createDefaultField();
    const result = applyAthenaReconciliation(
      field,
      request(
        field,
        [
          { id: "life", kind: "set-life", value: 28 },
          {
            id: "invalid",
            kind: "set-group-quantity",
            groupId: "missing",
            value: 2,
          },
        ],
        false,
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.field.player.life).toBe(28);
    expect(result.appliedRepairIds).toEqual(["life"]);
    expect(result.rejectedRepairIds).toEqual(["invalid"]);
  });

  it("keeps Stop Tracking and Depower state intentional during unrelated reconciliation", () => {
    const group = createGenericGroup({ kind: "Creature", label: "Creature" });
    const intentional = withStackKey({
      ...group,
      trackingEnabled: false,
      abilitiesActive: false,
      depowerMode: "all" as const,
      statuses: { ...group.statuses, depowered: true },
    });
    const field = fieldWithGroups([intentional]);
    const result = applyAthenaReconciliation(
      field,
      request(field, [{ id: "life", kind: "set-life", value: 28 }]),
    );

    expect(result.field.groups[0]).toMatchObject({
      trackingEnabled: false,
      abilitiesActive: false,
      depowerMode: "all",
      statuses: { depowered: true },
    });
  });

  it("creates reconciliation history that undo and redo restore without reverse gameplay events", () => {
    const field = normalizeField({
      ...createDefaultField(),
      player: { ...createDefaultField().player, life: 31 },
    });
    useFieldStore.setState({ field });

    const result = useFieldStore.getState().applyReconciliation({
      repairs: [{ id: "life", kind: "set-life", value: 28 }],
      source: "manual-correction",
      level: "quick-correction",
      timestamp,
    });
    expect(result.ok).toBe(true);
    expect(useFieldStore.getState().field.player.life).toBe(28);
    expect(useFieldStore.getState().undoStack.at(-1)).toMatchObject({
      label: "Correction",
      summary: ["Life corrected from 31 to 28."],
    });

    useFieldStore.getState().undo();
    expect(useFieldStore.getState().field.player.life).toBe(31);
    useFieldStore.getState().redo();
    expect(useFieldStore.getState().field.player.life).toBe(28);
    expect(useFieldStore.getState().lastResult).toBeNull();
  });

  it("routes verified Echo correction intent through one reconciliation transaction", () => {
    const field = normalizeField({
      ...createDefaultField(),
      player: { ...createDefaultField().player, life: 31 },
    });
    useFieldStore.setState({ field });

    const ignored = useFieldStore.getState().processEchoReconciliation({
      transcript: "Correction, life is 28.",
      speakerVerified: false,
    });
    expect(ignored.result).toBeNull();
    expect(useFieldStore.getState().field.player.life).toBe(31);

    const accepted = useFieldStore.getState().processEchoReconciliation({
      transcript: "Correction, life is 28.",
      speakerVerified: true,
    });
    expect(accepted.result?.ok).toBe(true);
    expect(useFieldStore.getState().field.player.life).toBe(28);
    expect(useFieldStore.getState().undoStack.at(-1)?.label).toBe("Correction");
    expect(accepted.result?.generatedGameEvents).toEqual([]);
  });

  it("invalidates only affected Prepared Actions and continues live turn coordination", () => {
    const treasure = createGenericGroup({
      kind: "Token",
      label: "Treasure",
      quantity: 1,
      cardTypes: ["Artifact"],
      subtypes: ["Treasure"],
      token: true,
    });
    const base = fieldWithGroups([treasure]);
    useFieldStore.setState({
      field: {
        ...base,
        ambient: { ...base.ambient, currentMode: "activeTurn" },
      },
    });
    useFieldStore.getState().plannerAddAction({
      id: "sac-treasure",
      type: "sacrifice",
      title: "Sac Treasure",
      relatedGroupId: treasure.id,
      execution: {
        support: "local",
        eventCategory: "permanent-sacrificed",
      },
    });
    useFieldStore.getState().plannerAddAction({
      id: "play-forest",
      type: "land-play",
      title: "Forest",
    });

    useFieldStore.getState().applyReconciliation({
      repairs: [
        {
          id: "no-treasure",
          kind: "set-group-quantity",
          groupId: treasure.id,
          value: 0,
        },
      ],
      source: "manual-correction",
      level: "quick-correction",
      timestamp,
    });
    const current = useFieldStore.getState().field;
    const sacrifice = current.preTurnPlanner.actions.find(
      (action) => action.id === "sac-treasure",
    );
    const forest = current.preTurnPlanner.actions.find(
      (action) => action.id === "play-forest",
    );

    expect(sacrifice?.prepared.validity).toBe("invalidated");
    expect(forest?.prepared.validity).not.toBe("invalidated");
    expect(current.ambient.currentMode).toBe("activeTurn");
    expect(
      current.athena.reconciliation.diagnostics.preparedActionsInvalidated,
    ).toBe(1);
  });

  it("revalidates a pending target decision after its object is removed and preserves unrelated decisions", () => {
    const target = createGenericGroup({ kind: "Creature", label: "Target" });
    const field = fieldWithGroups([target]);
    const candidates = buildAthenaDecisionCandidates(field, {
      controller: "you",
      zones: ["battlefield"],
      cardTypes: ["Creature"],
    });
    const decision = createAthenaDecisionRequest({
      id: "target-decision",
      sessionId: field.session.id,
      participantId: field.multiplayer.registry.localParticipantId,
      type: "target-selection",
      prompt: "Choose a target creature you control.",
      candidates,
      targetConstraints: {
        controller: "you",
        zones: ["battlefield"],
        cardTypes: ["Creature"],
      },
      stateFingerprint: athenaDecisionStateFingerprint(field),
      timestamp,
    });
    const pending = {
      ...field,
      athena: {
        ...field.athena,
        decisions: enqueueAthenaDecision(
          field.athena.decisions,
          decision,
          timestamp,
        ),
      },
    };
    useFieldStore.setState({ field: pending });

    useFieldStore.getState().applyReconciliation({
      repairs: [
        {
          id: "remove-target",
          kind: "remove-object-representation",
          groupId: target.id,
        },
      ],
      timestamp,
    });
    const current = useFieldStore.getState().field;
    const refreshed = current.athena.decisions.requests.find(
      (request) => request.id === decision.id,
    );

    expect(["invalidated", "stale", "active"]).toContain(refreshed?.status);
    expect(refreshed?.answer).toBeNull();
    expect(
      refreshed?.candidates.every(
        (candidate) => candidate.groupId !== target.id || !candidate.eligible,
      ),
    ).toBe(true);
  });

  it("restores persisted reconciliation state and never replays an interrupted transient operation", () => {
    const defaults = normalizeAthenaReconciliationState(undefined, timestamp);
    expect(defaults).toMatchObject({
      active: null,
      recent: [],
      catchUpSuggested: false,
    });
    const field = createDefaultField();
    const applied = applyAthenaReconciliation(
      field,
      request(field, [{ id: "life", kind: "set-life", value: 28 }]),
    );
    const restored = normalizeAthenaReconciliationState(
      {
        ...applied.state,
        active: { ...applied.record, status: "applying" },
      },
      timestamp,
    );

    expect(restored.active).toBeNull();
    expect(restored.recent.at(-1)).toMatchObject({ status: "failed" });
    expect(restored.diagnostics.recoveryFailures).toBe(1);
  });

  it("marks resume divergence as a Catch Me Up suggestion without inventing actions", () => {
    const field = {
      ...createDefaultField(),
      ambient: {
        ...createDefaultField().ambient,
        currentMode: "activeTurn" as const,
      },
    };
    const backgrounded = markAthenaReconciliationLifecycle(
      field,
      "app-backgrounded",
      timestamp,
    );
    const resumed = markAthenaReconciliationLifecycle(
      backgrounded,
      "app-foregrounded",
      "2026-08-20T12:05:00.000Z",
    );

    expect(resumed.athena.reconciliation).toMatchObject({
      lastBackgroundedAt: timestamp,
      lastResumedAt: "2026-08-20T12:05:00.000Z",
      catchUpSuggested: true,
    });
    expect(resumed.groups).toEqual(field.groups);
  });

  it("refuses unsafe historical reconstruction and identifies the authority path", () => {
    const field = createDefaultField();
    const missed = createAthenaReconciliationRequest({
      field,
      repairs: [
        { id: "land", kind: "set-relevant-total", key: "lands", value: 9 },
      ],
      level: "missed-real-game-action",
      timestamp,
    });

    expect(
      canSafelyProcessMissedRealGameAction({ request: missed }),
    ).toMatchObject({
      safe: false,
      disposition: "correction-only",
    });
    expect(
      canSafelyProcessMissedRealGameAction({
        request: missed,
        boardStateAuthorityAvailable: true,
      }),
    ).toMatchObject({ safe: false, disposition: "authority-required" });
    expect(
      canSafelyProcessMissedRealGameAction({
        request: missed,
        historicalSnapshotId: "snapshot:before-land",
        exactEventTimestamp: timestamp,
      }),
    ).toMatchObject({ safe: true, disposition: "process-real-action" });
  });

  it("preserves BoardState session authority while accepting authority-sourced reconciliation", () => {
    const local = createDefaultField();
    const field = {
      ...local,
      session: {
        ...local.session,
        currentSessionAuthority: "boardstate-authority" as const,
      },
    };
    const localRequest = createAthenaReconciliationRequest({
      field,
      repairs: [{ id: "life-local", kind: "set-life", value: 28 }],
      timestamp,
    });
    const rejected = applyAthenaReconciliation(field, localRequest);
    expect(rejected).toMatchObject({ ok: false, status: "failed" });
    expect(rejected.field.player.life).toBe(field.player.life);

    const authorityRequest = createAthenaReconciliationRequest({
      field,
      repairs: [{ id: "life-authority", kind: "set-life", value: 28 }],
      source: "boardstate-authority",
      confidence: "authority-confirmed",
      timestamp,
    });
    const accepted = applyAthenaReconciliation(field, authorityRequest);
    expect(accepted.ok).toBe(true);
    expect(accepted.field.player.life).toBe(28);
    expect(accepted.state.diagnostics.authorityReconciliations).toBe(1);
  });

  it("keeps a 150-field correction batch bounded and platform-neutral", () => {
    const groups = Array.from({ length: 150 }, (_, index) =>
      createGenericGroup({
        kind: "Token",
        label: `Token ${index}`,
        quantity: index + 1,
        token: true,
      }),
    );
    const field = fieldWithGroups(groups);
    const repairs: AthenaReconciliationRepair[] = groups.map(
      (group, index) => ({
        id: `repair:${index}`,
        kind: "set-group-quantity",
        groupId: group.id,
        value: index + 2,
      }),
    );
    const started = performance.now();
    const result = applyAthenaReconciliation(field, request(field, repairs));

    expect(result.ok).toBe(true);
    expect(result.discrepancies).toHaveLength(150);
    expect(performance.now() - started).toBeLessThan(500);
    expect(JSON.stringify(result.state)).not.toMatch(
      /window|document|navigator|HTMLElement|localStorage|sessionStorage|indexedDB/,
    );
  });
});
