import { describe, expect, it } from "vitest";
import { activateField } from "../domain/engine";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import { createSessionExportEnvelope } from "../sharedSession";
import { useFieldStore } from "../state/useFieldStore";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  genericCreature,
  tracked,
  withCounters,
} from "../test/factories";
import {
  ADVANCED_UNAVAILABLE_REASON,
  MODE_HANDOFF_KIND,
  ModeManager,
  createCanonicalHandoffSnapshot,
  modeManager,
  serializeCanonicalHandoffSnapshot,
} from "./index";

describe("Simple and Advanced mode architecture", () => {
  it("defaults every Lite field to Simple Mode with Advanced unavailable", () => {
    const field = createDefaultField();

    expect(field.mode.currentMode).toBe("simple");
    expect(field.mode.simple.availability).toBe("available");
    expect(field.mode.simple.capabilities.lifeTracker).toBe(true);
    expect(field.mode.simple.capabilities.helperEngine).toBe(true);
    expect(field.mode.advanced.availability).toBe("unavailable");
    expect(field.mode.advanced.unavailableReason).toBe(
      ADVANCED_UNAVAILABLE_REASON,
    );
    expect(field.mode.advanced.capabilities.fullRulesAuthority).toBe(false);
    expect(field.mode.handoff.lockState).toBe("unlocked");
  });

  it("migrates legacy fields without mode metadata into Simple Mode", () => {
    const legacy = createDefaultField() as unknown as Record<string, unknown>;
    delete legacy.mode;

    const imported = sanitizeImportedField(legacy);

    expect(imported?.mode.currentMode).toBe("simple");
    expect(imported?.mode.advanced.availability).toBe("unavailable");
    expect(imported?.mode.compatibility.status).toBe("compatible");
  });

  it("forces stale Advanced-mode saves back to current Simple Mode runtime", () => {
    const stale = {
      ...createDefaultField(),
      mode: {
        ...createDefaultField().mode,
        currentMode: "advanced" as const,
        advanced: {
          ...createDefaultField().mode.advanced,
          availability: "available" as const,
        },
        handoff: {
          ...createDefaultField().mode.handoff,
          lockState: "transferred" as const,
        },
      },
    };

    const normalized = normalizeField(stale);

    expect(normalized.mode.currentMode).toBe("simple");
    expect(normalized.mode.advanced.availability).toBe("unavailable");
    expect(normalized.mode.handoff.lockState).toBe("unlocked");
  });

  it("negotiates local Simple capabilities without assuming Advanced capabilities", () => {
    const manager = new ModeManager();
    const mode = manager.negotiateCapabilities(createDefaultField());
    const diagnostics = manager.diagnostics();

    expect(mode.simple.capabilities.localPersistence).toBe(true);
    expect(mode.advanced.capabilities.dryRun).toBe(false);
    expect(diagnostics).toMatchObject({
      currentMode: "simple",
      authorityOwner: "local-lite",
      sessionReady: true,
      futureHandoffReady: true,
      lockState: "unlocked",
    });
  });

  it("validates local session compatibility but returns Advanced unavailable for handoff", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const manager = new ModeManager();
    const compatibility = manager.validateSessionCompatibility(field);
    const handoff = manager.prepareAdvancedHandoff(field);

    expect(compatibility.ok).toBe(true);
    expect(compatibility.compatibility.status).toBe("compatible");
    expect(handoff.ok).toBe(false);
    expect(handoff.status).toBe("advancedUnavailable");
    expect(handoff.reason).toBe(ADVANCED_UNAVAILABLE_REASON);
    expect(handoff.snapshot?.kind).toBe(MODE_HANDOFF_KIND);
    expect(handoff.snapshot?.mode.currentMode).toBe("simple");
    expect(handoff.snapshot?.authority.transferSupported).toBe(false);
  });

  it("creates deterministic canonical handoff snapshots with complete Lite state", () => {
    const anim = withCounters(tracked(animPakal()), { "+1/+1": 3, Shield: 1 });
    const generic = genericCreature(2);
    const field = normalizeField(fieldWith([anim, generic]));
    const snapshot = createCanonicalHandoffSnapshot(
      field,
      "2026-07-11T00:00:00.000Z",
    );
    const serialized = serializeCanonicalHandoffSnapshot(snapshot);
    const reparsed = JSON.parse(serialized) as typeof snapshot;
    const animSnapshot = reparsed.liteSnapshot.battlefield.find((group) =>
      group.cardIdentity?.name.includes("Anim Pakal"),
    );

    expect(reparsed.kind).toBe(MODE_HANDOFF_KIND);
    expect(reparsed.session.metadata.id).toBe(field.session.id);
    expect(reparsed.liteSnapshot.player.life).toBe(40);
    expect(reparsed.liteSnapshot.mode.currentMode).toBe("simple");
    expect(animSnapshot?.counters["+1/+1"]).toBe(3);
    expect(animSnapshot?.counters.Shield).toBe(1);
    expect(animSnapshot?.objectIds).toEqual(field.groups[0].session?.objectIds);
    expect(reparsed.liteSnapshot.battlefield).toHaveLength(2);
  });

  it("adds mode, authority, capabilities, and compatibility metadata to exports", () => {
    const field = normalizeField(fieldWith([genericCreature()]));
    const envelope = createSessionExportEnvelope(
      field,
      "2026-07-11T00:00:00.000Z",
    );
    const imported = sanitizeImportedField(envelope);

    expect(envelope.mode.currentMode).toBe("simple");
    expect(envelope.authority).toEqual({
      rules: "local-lite",
      session: "local-lite",
      mode: "local-lite",
      multiplayer: "local-lite",
    });
    expect(envelope.capabilities.simpleMode.lifeTracker).toBe(true);
    expect(envelope.capabilities.advancedMode.fullRulesAuthority).toBe(false);
    expect(envelope.compatibility.status).toBe("compatible");
    expect(imported?.mode.currentMode).toBe("simple");
    expect(imported?.mode.advanced.availability).toBe("unavailable");
  });

  it("keeps Activate Field, undo, and session identity unchanged", () => {
    const field = normalizeField(
      fieldWith([tracked(animPakal()), tracked(catharsCrusade())]),
    );
    const result = activateField(field);

    expect(result.field.mode.currentMode).toBe("simple");
    expect(result.field.session.id).toBe(field.session.id);
    expect(
      result.field.groups.find((group) => group.label === "Gnome")?.quantity,
    ).toBe(1);

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
    useFieldStore.getState().undo();

    expect(useFieldStore.getState().field.mode.currentMode).toBe("simple");
    expect(useFieldStore.getState().field.session.id).toBe(field.session.id);
    expect(
      useFieldStore
        .getState()
        .field.groups.find((group) => group.label === "Gnome"),
    ).toBeUndefined();
  });

  it("keeps return and launch abstractions unavailable without fake integration", () => {
    expect(modeManager.receiveAdvancedReturn({}).ok).toBe(false);
    expect(modeManager.receiveAdvancedReturn({}).reason).toContain(
      "unavailable",
    );
    expect(modeManager.launch("boardstate-advanced")).toEqual({
      ok: false,
      target: "boardstate-advanced",
      reason:
        "Application launching is unavailable until a real ecosystem target is configured.",
    });
  });
});
