import { describe, expect, it } from "vitest";
import { activateField } from "../domain/engine";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import { useFieldStore } from "../state/useFieldStore";
import type { FieldState } from "../domain/types";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  genericCreature,
  testCard,
  tracked,
} from "../test/factories";
import {
  RulesAdapterManager,
  createLiteFieldSnapshot,
  createUnavailableCapabilities,
  parseRulesEvaluationResult,
  rulesAdapterManager,
  serializeLiteFieldSnapshot,
} from "./index";

describe("BoardState rules adapter architecture", () => {
  it("creates an unavailable adapter with unavailable capabilities", () => {
    const manager = new RulesAdapterManager();

    expect(manager.getStatus()).toBe("unavailable");
    expect(manager.getCapabilities()).toEqual(createUnavailableCapabilities());
    expect(manager.getDiagnostics()).toMatchObject({
      status: "unavailable",
      currentEngine: "lite-helper",
      fallbackReason: null,
    });
  });

  it("supports explicit status transitions without claiming integration", () => {
    const manager = new RulesAdapterManager();

    manager.transition("connecting");
    expect(manager.getStatus()).toBe("connecting");
    expect(manager.getDiagnostics().currentEngine).toBe("lite-helper");

    manager.transition("error", "Adapter health check failed.");
    expect(manager.getStatus()).toBe("error");
    expect(manager.getDiagnostics().lastAdapterError).toBe(
      "Adapter health check failed.",
    );
  });

  it("prepares version negotiation and rejects unsupported future authority versions", () => {
    const manager = new RulesAdapterManager();

    expect(manager.negotiateVersion({ boardStateVersion: "0.0.1" })).toBe(
      "unsupportedVersion",
    );
    expect(manager.getDiagnostics().status).toBe("unsupportedVersion");
    expect(manager.negotiateVersion({ boardStateVersion: "0.1.0" })).toBe(
      "disconnected",
    );
  });

  it("creates deterministic serializable Lite snapshots without UI-only image data", () => {
    const card = testCard({
      name: "Scryfall Fixture",
      typeLine: "Creature - Wizard",
      oracleText: "Whenever you draw a card, gain 1 life.",
      imageUrl: "https://cards.scryfall.io/large/front/example.jpg",
      imageSmall: "https://cards.scryfall.io/small/front/example.jpg",
      power: "2",
      toughness: "3",
    });
    const field = normalizeField(fieldWith([tracked(card), genericCreature()]));
    const first = serializeLiteFieldSnapshot(createLiteFieldSnapshot(field));
    const second = serializeLiteFieldSnapshot(createLiteFieldSnapshot(field));
    const parsed = JSON.parse(first) as ReturnType<
      typeof createLiteFieldSnapshot
    >;

    expect(first).toBe(second);
    expect(first).toContain("Scryfall Fixture");
    expect(first).not.toContain("cards.scryfall.io");
    expect(parsed.metadata.appName).toBe("Baord State Lite");
    const fixturePermanent = parsed.battlefield.find(
      (entry) => entry.cardIdentity?.name === "Scryfall Fixture",
    );
    expect(fixturePermanent).toMatchObject({
      stableId: field.groups.find(
        (group) => group.identity?.name === "Scryfall Fixture",
      )?.id,
      trackingEnabled: true,
      genericPlaceholder: false,
      zone: "battlefield",
    });
    expect(fixturePermanent?.basePowerToughness.basePower).toBe(2);
    expect(parsed.relevantTotals.creatures).toBe(2);
  });

  it("serializes Not Tracked and depower state while preserving object totals", () => {
    const anim = {
      ...tracked(animPakal()),
      trackingEnabled: false,
      abilitiesActive: false,
      depowerMode: "all" as const,
      statuses: { ...tracked(animPakal()).statuses, depowered: true },
    };
    const snapshot = createLiteFieldSnapshot(normalizeField(fieldWith([anim])));
    const permanent = snapshot.battlefield.find((entry) =>
      entry.cardIdentity?.name.includes("Anim Pakal"),
    );

    expect(permanent?.trackingEnabled).toBe(false);
    expect(permanent?.depowerState).toMatchObject({
      abilitiesActive: false,
      mode: "all",
    });
    expect(snapshot.relevantTotals.creatures).toBe(1);
  });

  it("parses valid future rules results and rejects fabricated payloads", () => {
    const parsed = parseRulesEvaluationResult({
      ok: true,
      source: "boardstate-authority",
      rulesVersion: "future-1",
      messages: ["Evaluated by BoardState."],
      warnings: ["Unsupported optional choice."],
    });

    expect(parsed).toMatchObject({
      ok: true,
      source: "boardstate-authority",
      rulesVersion: "future-1",
      triggerList: [],
      messages: ["Evaluated by BoardState."],
    });
    expect(parseRulesEvaluationResult({ ok: true, source: "mock" })).toBeNull();
  });

  it("falls back to the existing Lite helper engine when BoardState is unavailable", () => {
    const manager = new RulesAdapterManager();
    const field = fieldWith([tracked(animPakal()), tracked(catharsCrusade())]);
    const result = manager.evaluateWithFallback(field, () =>
      activateField(field),
    );
    const diagnostics = manager.getDiagnostics();

    expect(result.title).toBe("Field Activated");
    expect(
      result.field.groups.find((group) => group.label === "Gnome")?.quantity,
    ).toBe(1);
    expect(diagnostics.status).toBe("unavailable");
    expect(diagnostics.currentEngine).toBe("lite-helper");
    expect(diagnostics.fallbackReason).toContain("not configured");
    expect(diagnostics.lastAttemptedEvaluation).toMatchObject({
      fieldId: field.id,
      snapshotVersion: 1,
      serializationVersion: 1,
    });
  });

  it("handles snapshot serialization failure without crashing Lite helper resolution", () => {
    const manager = new RulesAdapterManager();
    const corruptField = {
      ...createDefaultField(),
      groups: [{ id: "corrupt-group" }],
    } as unknown as FieldState;
    const fallbackField = createDefaultField();
    const result = manager.evaluateWithFallback(corruptField, () =>
      activateField(fallbackField),
    );

    expect(result.summary.join(" ")).toContain(
      "No supported active abilities resolved",
    );
    expect(manager.getDiagnostics()).toMatchObject({
      status: "error",
      currentEngine: "lite-helper",
    });
    expect(manager.getDiagnostics().fallbackReason).toBeTruthy();
  });

  it("keeps the store Activate Field and Undo behavior on the fallback path", () => {
    const field = fieldWith([tracked(animPakal()), tracked(catharsCrusade())]);
    rulesAdapterManager.reset();
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

    expect(
      useFieldStore
        .getState()
        .field.groups.find((group) => group.label === "Gnome")?.quantity,
    ).toBe(1);
    expect(useFieldStore.getState().lastResult?.title).toBe("Field Activated");
    expect(rulesAdapterManager.getDiagnostics().currentEngine).toBe(
      "lite-helper",
    );

    useFieldStore.getState().undo();

    expect(
      useFieldStore
        .getState()
        .field.groups.find((group) => group.label === "Gnome"),
    ).toBeUndefined();
  });

  it("does not change saved-field import shape or require BoardState metadata", () => {
    const legacy = createDefaultField();
    const imported = sanitizeImportedField(legacy);

    expect(imported).not.toBeNull();
    expect(imported).not.toHaveProperty("rulesAdapter");
    expect(imported?.groups.length).toBe(legacy.groups.length);
  });
});
