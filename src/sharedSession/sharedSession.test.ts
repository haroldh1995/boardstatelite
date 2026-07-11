import { describe, expect, it } from "vitest";
import { applyCounters, setTrackingEnabled } from "../domain/engine";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import { createLiteFieldSnapshot } from "../rulesAdapter";
import { useFieldStore } from "../state/useFieldStore";
import {
  animPakal,
  fieldWith,
  genericCreature,
  tracked,
} from "../test/factories";
import {
  SHARED_SESSION_EXPORT_KIND,
  createSessionExportEnvelope,
  sharedSessionManager,
} from "./index";

describe("canonical shared sessions", () => {
  it("creates local-only session metadata for new Lite fields", () => {
    const field = createDefaultField();

    expect(field.session.id).toMatch(/^BS-SESSION-/);
    expect(field.session.status).toBe("localOnly");
    expect(field.session.currentRulesAuthority).toBe("local-lite");
    expect(field.session.currentSessionAuthority).toBe("local-lite");
    expect(field.session.participants).toHaveLength(1);
    expect(field.groups[0].session).toMatchObject({
      sessionId: field.session.id,
      ownerParticipantId: field.session.participants[0].id,
      controllerParticipantId: field.session.participants[0].id,
    });
    expect(field.groups[0].session?.objectIds).toHaveLength(
      field.groups[0].quantity,
    );
  });

  it("preserves session identity through normalization, undo, and redo", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    useFieldStore.setState({
      field,
      hydrated: true,
      startupVisible: false,
      modal: null,
      lastResult: null,
      undoStack: [],
      redoStack: [],
    });

    const sessionId = field.session.id;
    useFieldStore.getState().setLifeExact(37);
    expect(useFieldStore.getState().field.session.id).toBe(sessionId);

    useFieldStore.getState().undo();
    expect(useFieldStore.getState().field.session.id).toBe(sessionId);

    useFieldStore.getState().redo();
    expect(useFieldStore.getState().field.session.id).toBe(sessionId);
  });

  it("migrates legacy saves without session metadata into local-only sessions", () => {
    const legacy = createDefaultField() as unknown as Record<string, unknown>;
    const originalFieldId = legacy.id;
    const legacyGroup = (legacy.groups as Record<string, unknown>[])[0];
    delete legacy.session;
    delete legacyGroup.session;
    legacy.legacyRootPayload = { keep: true };

    const imported = sanitizeImportedField(legacy);

    expect(imported).not.toBeNull();
    expect(imported?.id).toBe(originalFieldId);
    expect(imported?.session.id).toMatch(/^BS-SESSION-/);
    expect(imported?.session.status).toBe("localOnly");
    expect(imported?.groups[0].session?.sessionId).toBe(imported?.session.id);
    expect(
      (imported as unknown as { legacyRootPayload?: unknown })
        .legacyRootPayload,
    ).toEqual({ keep: true });
  });

  it("exports and imports canonical session envelopes without changing identity", () => {
    const field = normalizeField(fieldWith([genericCreature(2)]));
    const envelope = createSessionExportEnvelope(
      field,
      "2026-07-11T00:00:00.000Z",
    );
    const imported = sanitizeImportedField(envelope);

    expect(envelope.kind).toBe(SHARED_SESSION_EXPORT_KIND);
    expect(envelope.session.id).toBe(field.session.id);
    expect(envelope.session.importExport.exported).toBe(true);
    expect(imported?.session.id).toBe(field.session.id);
    expect(imported?.session.status).toBe("localOnly");
    expect(imported?.session.currentSessionAuthority).toBe("local-lite");
    expect(imported?.session.importExport.imported).toBe(true);
    expect(imported?.groups[0].session?.objectIds).toEqual(
      field.groups[0].session?.objectIds,
    );
  });

  it("keeps canonical object IDs stable across stack split and merge", () => {
    const stack = tracked(animPakal(), 4);
    const field = normalizeField(fieldWith([stack]));
    const originalIds = field.groups[0].session?.objectIds ?? [];
    const stopped = setTrackingEnabled(
      field,
      field.groups[0].id,
      false,
      "custom",
      2,
    ).field;
    const stoppedIds =
      stopped.groups.find((group) => group.trackingEnabled === false)?.session
        ?.objectIds ?? [];
    const trackedIds =
      stopped.groups.find((group) => group.trackingEnabled !== false)?.session
        ?.objectIds ?? [];
    const resumedGroup = stopped.groups.find(
      (group) => group.trackingEnabled === false,
    );
    const resumed = setTrackingEnabled(
      stopped,
      resumedGroup?.id ?? "",
      true,
      "all",
      1,
    ).field;

    expect([...trackedIds, ...stoppedIds].sort()).toEqual(
      [...originalIds].sort(),
    );
    expect(resumed.groups).toHaveLength(1);
    expect(resumed.groups[0].session?.objectIds.sort()).toEqual(
      [...originalIds].sort(),
    );
  });

  it("preserves object identity when counters split a stack", () => {
    const stack = genericCreature(3);
    const field = normalizeField(fieldWith([stack]));
    const originalIds = field.groups[0].session?.objectIds ?? [];
    const result = applyCounters(
      field,
      field.groups[0].id,
      "Shield",
      1,
      "one",
      1,
      "correction",
    );
    const idsAfter = result.field.groups.flatMap(
      (group) => group.session?.objectIds ?? [],
    );

    expect(idsAfter.sort()).toEqual([...originalIds].sort());
    expect(new Set(idsAfter).size).toBe(3);
  });

  it("includes session and ownership metadata in Lite rules-adapter snapshots", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const snapshot = createLiteFieldSnapshot(field);
    const permanent = snapshot.battlefield[0];

    expect(snapshot.session.metadata.id).toBe(field.session.id);
    expect(snapshot.session.authority).toMatchObject({
      rules: "local-lite",
      session: "local-lite",
      status: "localOnly",
    });
    expect(permanent.sessionId).toBe(field.session.id);
    expect(permanent.objectIds).toEqual(field.groups[0].session?.objectIds);
    expect(permanent.ownerParticipantId).toBe(field.session.participants[0].id);
  });

  it("reports future synchronization hooks as unavailable without changing Lite", () => {
    const diagnostics = sharedSessionManager.diagnostics(createDefaultField());

    expect(diagnostics).toMatchObject({
      status: "localOnly",
      currentRulesAuthority: "local-lite",
      currentSessionAuthority: "local-lite",
    });
    expect(sharedSessionManager.connect()).toEqual({
      ok: false,
      reason: "Shared sessions require future BoardState ecosystem support.",
      status: "localOnly",
    });
    expect(sharedSessionManager.synchronize().ok).toBe(false);
  });
});
