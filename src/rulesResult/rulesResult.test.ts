import { describe, expect, it } from "vitest";
import { activateField } from "../domain/engine";
import { normalizeField } from "../domain/field";
import { useFieldStore } from "../state/useFieldStore";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  genericCreature,
  testCard,
  tracked,
} from "../test/factories";
import type { BoardStateRulesEvaluation } from "../rulesAdapter";
import {
  RULES_RESULT_SCHEMA_VERSION,
  RulesResultRenderer,
  canonicalizeLiteHelperResult,
  rulesResultRenderer,
  validateRulesResult,
  type CanonicalRulesResult,
} from "./index";

describe("rules result rendering layer", () => {
  it("converts Lite helper output into a canonical rules result and renders the same battlefield", () => {
    const before = normalizeField(
      fieldWith([tracked(animPakal()), tracked(catharsCrusade())]),
    );
    const helper = activateField(before);
    const renderer = new RulesResultRenderer();
    const output = renderer.renderLiteHelperResult(before, helper);

    expect(output.validation.status).toBe("valid");
    expect(output.canonical.source).toBe("lite-helper");
    expect(output.result.rendering).toMatchObject({
      source: "lite-helper",
      authorityLabel: "Local Helper Engine",
      validationStatus: "valid",
    });
    expect(
      output.result.field.groups.find((group) => group.label === "Gnome"),
    ).toBeTruthy();
    expect(output.accessibilityAnnouncements.join(" ")).toContain("Anim Pakal");
    expect(output.animationQueue.length).toBeGreaterThan(0);
  });

  it("validates malformed and unknown-object results without crashing", () => {
    const before = normalizeField(fieldWith([genericCreature()]));
    const canonical = canonicalFor(before, [
      {
        kind: "counter",
        target: { groupId: "missing-object" },
        counter: "+1/+1",
        mode: "add",
        amount: 1,
      },
    ]);
    const renderer = new RulesResultRenderer();
    const validation = validateRulesResult(before, canonical);
    const output = renderer.renderCanonical(before, canonical);

    expect(validation.status).toBe("invalid");
    expect(validation.errors.join(" ")).toContain("unknown battlefield object");
    expect(output.result.field).toBe(before);
    expect(output.result.rendering?.validationStatus).toBe("recovered");
    expect(output.result.summary[0]).toContain("could not be applied safely");
  });

  it("renders authoritative life, counter, token, status, transform, depower, and tracking changes", () => {
    const creature = genericCreature();
    const before = normalizeField(fieldWith([creature]));
    const group = before.groups[0];
    const canonical = canonicalFor(
      before,
      [
        {
          kind: "life",
          player: "you",
          mode: "gain",
          amount: 3,
        },
        {
          kind: "counter",
          target: { groupId: group.id },
          counter: "+1/+1",
          mode: "add",
          amount: 2,
        },
        {
          kind: "token",
          mode: "created",
          name: "Servo",
          quantity: 2,
          power: 1,
          toughness: 1,
          subtypes: ["Servo"],
          tapped: true,
        },
        {
          kind: "status",
          target: { groupId: group.id },
          status: "attacking",
          value: true,
        },
        {
          kind: "transform",
          target: { groupId: group.id },
          transformed: true,
          label: "Transformed Test Creature",
        },
        {
          kind: "depower",
          target: { groupId: group.id },
          mode: "all",
        },
        {
          kind: "tracking",
          target: { groupId: group.id },
          trackingEnabled: false,
        },
      ],
      {
        source: "boardstate-authority",
        rulesVersion: "1.0.0",
        title: "Authoritative Result",
        summary: ["BoardState result applied."],
      },
    );
    const output = new RulesResultRenderer().renderCanonical(before, canonical);
    const renderedCreature = output.result.field.groups.find(
      (entry) => entry.label === "Transformed Test Creature",
    );

    expect(output.validation.status).toBe("valid");
    expect(output.result.field.player.life).toBe(43);
    expect(renderedCreature?.counters["+1/+1"]).toBe(2);
    expect(renderedCreature?.statuses.attacking).toBe(true);
    expect(renderedCreature?.statuses.transformed).toBe(true);
    expect(renderedCreature?.depowerMode).toBe("all");
    expect(renderedCreature?.trackingEnabled).toBe(false);
    expect(
      output.result.field.groups.find((entry) => entry.label === "Servo"),
    ).toBeTruthy();
  });

  it("renders future warnings, unsupported interactions, judge notes, replay markers, and reduced motion", () => {
    const before = normalizeField(fieldWith([genericCreature()]));
    const canonical = canonicalFor(before, [], {
      warnings: ["Replacement choice needs review."],
      unsupportedInteractions: ["Manual target selection required."],
      judgeNotes: ["Judge note preserved."],
      replayMarkers: [
        {
          id: "replay-1",
          timestamp: "2026-07-17T00:00:00.000Z",
          label: "Trigger group",
          description: "Grouped trigger replay marker.",
        },
      ],
    });
    const output = new RulesResultRenderer().renderCanonical(
      before,
      canonical,
      {
        mode: "reduced-motion",
      },
    );

    expect(output.notifications.map((notice) => notice.kind)).toEqual([
      "rules-warning",
      "manual-resolution",
      "judge-note",
      "replay-available",
    ]);
    expect(output.result.rendering?.animationMode).toBe("reduced-motion");
    expect(output.result.rendering?.replayMarkers).toHaveLength(1);
    expect(output.accessibilityAnnouncements.join(" ")).toContain("Warning");
  });

  it("maps current BoardState adapter result contracts into Lite rendering", () => {
    const before = normalizeField(fieldWith([genericCreature()]));
    const group = before.groups[0];
    const evaluation: BoardStateRulesEvaluation = {
      ok: true,
      source: "boardstate-authority",
      rulesVersion: "1.0.0",
      triggerList: [
        {
          id: "trigger-1",
          label: "Cathars' Crusade",
          detail: "A creature entered.",
        },
      ],
      replacementEffects: [],
      staticRecalculations: [],
      battlefieldChanges: [],
      lifeChanges: [
        {
          kind: "life",
          player: "you",
          mode: "gain",
          amount: 5,
        },
      ],
      counterChanges: [
        {
          kind: "counter",
          groupId: group.id,
          counter: "Shield",
          amount: 1,
          mode: "placed",
        },
      ],
      tokenChanges: [],
      attachments: [],
      zoneChanges: [],
      messages: ["Authoritative changes applied."],
      warnings: [],
      unsupportedInteractions: [],
      events: [],
    };
    const output = new RulesResultRenderer().renderAuthoritativeResult(
      before,
      evaluation,
    );

    expect(output.result.field.player.life).toBe(45);
    expect(output.result.field.groups[0].counters.Shield).toBe(1);
    expect(output.result.rendering?.source).toBe("boardstate-authority");
    expect(output.result.details[0].label).toContain("Trigger");
  });

  it("keeps store Activate Field, undo, persistence shape, and Scryfall identity behavior intact", () => {
    const scryfallBacked = tracked({
      ...testCard({
        name: "Renderer Scryfall Fixture",
        typeLine: "Creature - Wizard",
        oracleText: "Whenever another creature enters, scry 1.",
        cardId: "renderer-scryfall-fixture",
      }),
      oracleId: "renderer-oracle",
      setCode: "tst",
      collectorNumber: "6",
    });
    const field = normalizeField(
      fieldWith([
        tracked(animPakal()),
        tracked(catharsCrusade()),
        scryfallBacked,
      ]),
    );
    useFieldStore.setState({
      field,
      hydrated: true,
      startupVisible: false,
      modal: null,
      lastResult: null,
      undoStack: [],
      redoStack: [],
    });

    useFieldStore.getState().activateField();

    expect(useFieldStore.getState().lastResult?.rendering?.source).toBe(
      "lite-helper",
    );
    expect(
      useFieldStore
        .getState()
        .field.groups.some((group) => group.label === "Gnome"),
    ).toBe(true);

    useFieldStore.getState().undo();

    expect(
      useFieldStore
        .getState()
        .field.groups.some((group) => group.label === "Gnome"),
    ).toBe(false);
    expect(useFieldStore.getState().exportField()).not.toContain(
      "animationQueue",
    );
    expect(rulesResultRenderer.getDiagnostics().renderingSource).toBe(
      "lite-helper",
    );
  });

  it("keeps helper canonicalization deterministic for existing result details", () => {
    const before = normalizeField(
      fieldWith([tracked(animPakal()), tracked(catharsCrusade())]),
    );
    const helper = activateField(before);
    const first = canonicalizeLiteHelperResult(
      before,
      helper,
      "2026-07-17T00:00:00.000Z",
    );
    const second = canonicalizeLiteHelperResult(
      before,
      helper,
      "2026-07-17T00:00:00.000Z",
    );

    expect(first.schemaVersion).toBe(RULES_RESULT_SCHEMA_VERSION);
    expect(first.summary).toEqual(second.summary);
    expect(first.details.map((entry) => entry.detail)).toEqual(
      second.details.map((entry) => entry.detail),
    );
  });
});

function canonicalFor(
  field: ReturnType<typeof normalizeField>,
  changes: CanonicalRulesResult["changes"],
  overrides: Partial<CanonicalRulesResult> & {
    source?: CanonicalRulesResult["source"];
    rulesVersion?: string | null;
  } = {},
): CanonicalRulesResult {
  const source = overrides.source ?? "lite-helper";
  return {
    id: "rules-result-test",
    schemaVersion: RULES_RESULT_SCHEMA_VERSION,
    fieldId: field.id,
    sessionId: field.session.id,
    source,
    authority: {
      source,
      label:
        source === "boardstate-authority"
          ? "BoardState Authority"
          : "Local Helper Engine",
      rulesVersion: overrides.rulesVersion ?? null,
      adapterVersion: "0.1.0",
      sessionAuthority:
        source === "boardstate-authority"
          ? "boardstate-authority"
          : "local-lite",
    },
    title: overrides.title ?? "Rules Result",
    summary: overrides.summary ?? ["Rules result rendered."],
    details: overrides.details ?? [],
    events: overrides.events ?? [],
    changes,
    changedGroupIds: overrides.changedGroupIds ?? [],
    warnings: overrides.warnings ?? [],
    messages: overrides.messages ?? [],
    unsupportedInteractions: overrides.unsupportedInteractions ?? [],
    judgeNotes: overrides.judgeNotes ?? [],
    replayMarkers: overrides.replayMarkers ?? [],
    loopDetected: overrides.loopDetected ?? false,
    createdAt: "2026-07-17T00:00:00.000Z",
  };
}
