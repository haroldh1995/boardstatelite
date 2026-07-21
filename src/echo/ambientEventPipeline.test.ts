import { describe, expect, it } from "vitest";
import { setLife as resolveSetLife } from "../domain/engine";
import { createDefaultField, normalizeField } from "../domain/field";
import type { FieldState } from "../domain/types";
import { useFieldStore } from "../state/useFieldStore";
import {
  animPakal,
  fieldWith,
  genericCreature,
  tracked,
} from "../test/factories";
import {
  AmbientEventPipeline,
  assignAmbientConfidence,
  createAmbientIntent,
  createAmbientPreview,
  decideAmbientApproval,
  resolveAmbientEntities,
  serializeAmbientCanonicalEvent,
  validateAmbientContext,
  validateAmbientRules,
} from "./ambientEventPipeline";

describe("Canonical Ambient Event Pipeline", () => {
  it("creates normalized reusable intents without mutating input", () => {
    const input = {
      id: "intent-1",
      kind: "modify-life" as const,
      source: "manual" as const,
      actor: "you" as const,
      payload: { amount: 3, ignored: { nested: true }, note: "gain" },
      confidence: "high" as const,
    };

    const intent = createAmbientIntent(input, "2026-07-20T00:00:00.000Z");

    expect(intent).toMatchObject({
      id: "intent-1",
      kind: "modify-life",
      source: "manual",
      actor: "you",
      payload: { amount: 3, note: "gain" },
      confidence: "high",
    });
    expect(input.payload).toHaveProperty("ignored");
  });

  it("resolves battlefield, player, counter, zone, session, total, and object entities", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const group = field.groups[0];
    const objectId = group.session?.objectIds[0] ?? group.id;
    const intent = createAmbientIntent({
      kind: "add-counters",
      source: "manual",
      entities: [
        { kind: "group", id: group.id },
        { kind: "object", id: objectId },
        { kind: "player", owner: "you" },
        { kind: "counter", name: "+1/+1" },
        { kind: "zone", zone: "battlefield" },
        { kind: "session", id: field.session.id },
        { kind: "total", key: "creatures" },
      ],
    });

    const resolved = resolveAmbientEntities(field, intent);

    expect(resolved).toHaveLength(7);
    expect(resolved.every((entity) => entity.status === "resolved")).toBe(true);
    expect(
      resolved.filter((entity) => entity.groupId === group.id),
    ).toHaveLength(2);
  });

  it("fails entity resolution before mutation when an object is missing", () => {
    const pipeline = new AmbientEventPipeline();
    const field = createDefaultField();
    const result = pipeline.process({
      field,
      intent: {
        id: "missing-entity",
        kind: "tap",
        source: "manual",
        entities: [{ kind: "group", id: "missing" }],
      },
      mutation: ({ field: current }) => current,
    });

    expect(result.status).toBe("failed");
    expect(result.field).toBe(field);
    expect(result.historyEntry).toBeNull();
    expect(
      result.stages.find((stage) => stage.stage === "entity-resolution")
        ?.status,
    ).toBe("failed");
  });

  it("validates current mode, session, and resolved context before rules run", () => {
    const field = createDefaultField();
    const intent = createAmbientIntent({
      kind: "attack",
      source: "manual",
      requiredMode: "combat",
    });
    const context = validateAmbientContext({
      field,
      intent,
      resolvedEntities: [],
    });

    expect(context.ok).toBe(false);
    expect(context.errors.join(" ")).toContain("requires combat");
  });

  it("rejects obviously invalid rule requests without using Lite as authority", () => {
    const field = createDefaultField();
    const group = field.groups[0];
    const intent = createAmbientIntent({
      kind: "add-counters",
      source: "manual",
      entities: [
        { kind: "group", id: group.id },
        { kind: "group", id: group.id },
      ],
      payload: { amount: -1 },
    });
    const resolved = resolveAmbientEntities(field, intent);
    const validation = validateAmbientRules({
      field,
      intent,
      resolvedEntities: resolved,
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" ")).toContain("duplicate");
    expect(validation.errors.join(" ")).toContain("amount cannot be negative");
  });

  it("propagates confidence and builds previews without committing", () => {
    const field = createDefaultField();
    const intent = createAmbientIntent({
      id: "preview-intent",
      kind: "create-token",
      source: "turn-planner",
      confidence: "medium",
      requiresPreview: true,
      payload: { quantity: 2 },
    });

    expect(assignAmbientConfidence(intent)).toBe("medium");
    const preview = createAmbientPreview({
      field,
      intent,
      resolvedEntities: [],
      timestamp: "2026-07-20T00:00:00.000Z",
    });

    expect(preview).toMatchObject({
      intentId: "preview-intent",
      requiresApproval: true,
    });
    expect(decideAmbientApproval({ method: "manual" }, true)).toBe(
      "preview-required",
    );
  });

  it("returns a preview result when approval is required", () => {
    const pipeline = new AmbientEventPipeline();
    const field = createDefaultField();

    const result = pipeline.process({
      field,
      intent: {
        id: "manual-preview",
        kind: "create-token",
        source: "turn-planner",
        requiresPreview: true,
      },
      approval: { method: "manual" },
      mutation: ({ field: current }) => ({
        ...current,
        name: "Should Not Commit",
      }),
    });

    expect(result.status).toBe("preview");
    expect(result.field.name).not.toBe("Should Not Commit");
    expect(result.undo).toBeNull();
    expect(result.event).toBeNull();
  });

  it("routes cancellation and recovery decisions before mutation", () => {
    const field = createDefaultField();
    const pipeline = new AmbientEventPipeline();
    const cancelled = pipeline.process({
      field,
      intent: {
        id: "cancelled",
        kind: "modify-life",
        source: "manual",
        payload: { amount: 1 },
      },
      approval: { method: "manual", decision: "cancelled" },
      mutation: ({ field: current }) => ({
        ...current,
        player: { ...current.player, life: 1 },
      }),
    });
    const recovery = pipeline.process({
      field,
      intent: {
        id: "recovery",
        kind: "modify-life",
        source: "manual",
        payload: { amount: 1 },
      },
      approval: { method: "recovery-required" },
      mutation: ({ field: current }) => ({
        ...current,
        player: { ...current.player, life: 1 },
      }),
    });

    expect(cancelled.status).toBe("cancelled");
    expect(recovery.status).toBe("recovery-required");
    expect(cancelled.field.player.life).toBe(40);
    expect(recovery.field.player.life).toBe(40);
  });

  it("creates a canonical event, undo snapshot, history entry, and sync metadata", () => {
    const pipeline = new AmbientEventPipeline();
    const field = createDefaultField();
    const result = pipeline.process({
      field,
      intent: {
        id: "life-gain",
        kind: "modify-life",
        source: "manual",
        payload: { amount: 3 },
        confidence: "high",
      },
      mutation: ({ field: current }) => resolveSetLife(current, 43, "gain"),
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Expected completion.");
    expect(result.field.player.life).toBe(43);
    expect(result.event).toMatchObject({
      source: "manual",
      confidence: "high",
      undoReference: result.historyEntry.id,
      historyReference: result.historyEntry.id,
      synchronization: { status: "local-only" },
    });
    expect(result.undo.before.player.life).toBe(40);
    expect(result.undo.after.player.life).toBe(43);
    expect(result.historyEntry.summary.join(" ")).toContain(
      "Life gain: 40 to 43",
    );
  });

  it("serializes canonical events deterministically", () => {
    const pipeline = new AmbientEventPipeline();
    const field = createDefaultField();
    const result = pipeline.process({
      field,
      intent: {
        id: "deterministic",
        kind: "modify-life",
        source: "manual",
        payload: { amount: 1 },
      },
      timestamp: "2026-07-20T00:00:00.000Z",
      mutation: ({ field: current }) => resolveSetLife(current, 41, "gain"),
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Expected completion.");
    const first = serializeAmbientCanonicalEvent(result.event);
    const second = serializeAmbientCanonicalEvent(
      structuredClone(result.event),
    );

    expect(first).toBe(second);
    expect(first).toContain("modify-life");
  });

  it("prevents duplicate request processing", () => {
    const pipeline = new AmbientEventPipeline();
    const field = createDefaultField();
    const request = {
      field,
      intent: {
        id: "duplicate",
        kind: "modify-life" as const,
        source: "manual" as const,
        payload: { amount: 1 },
      },
      mutation: ({ field: current }: { field: FieldState }) =>
        resolveSetLife(current, 41, "gain"),
    };

    expect(pipeline.process(request).status).toBe("completed");
    const duplicate = pipeline.process(request);

    expect(duplicate.status).toBe("failed");
    expect(duplicate.diagnostics.lastError).toContain("already processed");
  });

  it("rejects reentrant processing while preserving the outer event order", () => {
    const pipeline = new AmbientEventPipeline();
    const field = createDefaultField();
    let innerStatus = "not-run";
    const outer = pipeline.process({
      field,
      intent: {
        id: "outer",
        kind: "modify-life",
        source: "manual",
        payload: { amount: 1 },
      },
      mutation: ({ field: current }) => {
        innerStatus = pipeline.process({
          field: current,
          intent: {
            id: "inner",
            kind: "modify-life",
            source: "manual",
            payload: { amount: 1 },
          },
          mutation: ({ field: innerField }) =>
            resolveSetLife(innerField, 99, "gain"),
        }).status;
        return resolveSetLife(current, 41, "gain");
      },
    });

    expect(innerStatus).toBe("failed");
    expect(outer.status).toBe("completed");
    expect(outer.field.player.life).toBe(41);
  });

  it("does not corrupt the caller field when mutation throws or mutates its input", () => {
    const pipeline = new AmbientEventPipeline();
    const field = createDefaultField();
    const failed = pipeline.process({
      field,
      intent: { id: "throwing", kind: "modify-life", source: "manual" },
      mutation: () => {
        throw new Error("mutation failed");
      },
    });
    const mutating = new AmbientEventPipeline().process({
      field,
      intent: {
        id: "mutating",
        kind: "modify-life",
        source: "manual",
        payload: { amount: 1 },
      },
      mutation: ({ field: current }) => {
        current.player.life = 1;
        return current;
      },
    });

    expect(failed.status).toBe("failed");
    expect(field.player.life).toBe(40);
    expect(mutating.status).toBe("completed");
    expect(field.player.life).toBe(40);
  });

  it("integrates with the existing Zustand undo history without creating a second undo stack", () => {
    const field = createDefaultField();
    useFieldStore.setState({
      field,
      hydrated: true,
      startupVisible: false,
      modal: null,
      lastResult: null,
      undoStack: [],
      redoStack: [],
    });

    const outcome = useFieldStore.getState().processAmbientIntent(
      {
        id: "store-life",
        kind: "modify-life",
        source: "manual",
        payload: { amount: 2 },
      },
      ({ field: current }) => resolveSetLife(current, 42, "gain"),
    );

    expect(outcome.status).toBe("completed");
    expect(useFieldStore.getState().field.player.life).toBe(42);
    expect(useFieldStore.getState().undoStack).toHaveLength(1);

    useFieldStore.getState().undo();
    expect(useFieldStore.getState().field.player.life).toBe(40);

    useFieldStore.getState().redo();
    expect(useFieldStore.getState().field.player.life).toBe(42);
  });

  it("keeps Ambient Event processing compatible with existing field objects and tokens", () => {
    const pipeline = new AmbientEventPipeline();
    const field = normalizeField(fieldWith([genericCreature(2)]));
    const group = field.groups[0];
    const result = pipeline.process({
      field,
      intent: {
        id: "tap-token-stack",
        kind: "tap",
        source: "manual",
        entities: [{ kind: "group", id: group.id }],
      },
      mutation: ({ field: current }) =>
        normalizeField({
          ...current,
          groups: current.groups.map((entry) =>
            entry.id === group.id
              ? { ...entry, statuses: { ...entry.statuses, tapped: true } }
              : entry,
          ),
        }),
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Expected completion.");
    expect(result.field.groups[0].statuses.tapped).toBe(true);
    expect(result.field.groups[0].quantity).toBe(2);
    expect(result.event.resolvedEntities[0].groupId).toBe(group.id);
  });
});
