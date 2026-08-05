import { describe, expect, it } from "vitest";
import { createTokenGroup, withStackKey } from "../domain/cards";
import { setLife as resolveSetLife } from "../domain/engine";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import { ambientEventPipeline, createAmbientIntent } from "../echo";
import { rulesResultRenderer } from "../rulesResult";
import { createLiteFieldSnapshot } from "../rulesAdapter";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  genericCreature,
  testCard,
  tracked,
  withCounters,
} from "../test/factories";
import {
  athenaCoordinator,
  clearAthenaPreview,
  compareAthenaAuthoritySources,
  createAthenaAwarenessContext,
  createAthenaPreview,
  createDefaultAthenaState,
  getAthenaDiagnostics,
  normalizeAthenaSettings,
  normalizeAthenaState,
  recordAthenaPreview,
  resetAthenaState,
  transitionAthenaPreview,
} from "./foundation";
import type { AthenaState } from "./types";

const timestamp = "2026-08-01T00:00:00.000Z";

describe("Athena battlefield awareness foundation", () => {
  it("reads the current canonical battlefield without duplicating persistent state", () => {
    const field = normalizeField(
      fieldWith([
        tracked(animPakal()),
        tracked(catharsCrusade()),
        genericCreature(3),
      ]),
    );
    const before = structuredClone(field);
    const context = createAthenaAwarenessContext(field, { timestamp });
    const state = createDefaultAthenaState();

    expect(context).toMatchObject({
      version: 1,
      fieldId: field.id,
      sessionId: field.session.id,
      currentAuthoritySource: "lite-local-helper-result",
      directBattlefieldMutation: false,
      duplicateBattlefieldState: false,
      duplicateEventHistory: false,
      duplicateUndoStack: false,
    });
    expect(context.battlefield).toHaveLength(3);
    expect(context.relevantTotals).toContainEqual({
      key: "creatures",
      value: 4,
    });
    expect(context.currentEventWatchers.length).toBeGreaterThan(0);
    expect(state).not.toHaveProperty("battlefield");
    expect(field).toEqual(before);
  });

  it("keeps Not Tracked objects present while marking them unavailable as effect sources", () => {
    const anim = tracked(animPakal());
    const field = normalizeField(
      fieldWith([
        withStackKey({
          ...anim,
          trackingEnabled: false,
        }),
      ]),
    );
    const context = createAthenaAwarenessContext(field, { timestamp });
    const object = context.battlefield[0];

    expect(object.trackingEnabled).toBe(false);
    expect(object.canBeEffectSource).toBe(false);
    expect(object.sourceUnavailableReason).toBe("not-tracked");
    expect(context.trackingDisabledGroupIds).toEqual([object.groupId]);
    expect(context.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tracking-disabled",
          sourceGroupId: object.groupId,
          sourceAvailable: false,
        }),
      ]),
    );
  });

  it("keeps depower state distinct from Not Tracked state", () => {
    const anim = tracked(animPakal());
    const field = normalizeField(
      fieldWith([
        withStackKey({
          ...anim,
          abilitiesActive: false,
          depowerMode: "all",
          statuses: {
            ...anim.statuses,
            depowered: true,
          },
        }),
      ]),
    );
    const context = createAthenaAwarenessContext(field, { timestamp });
    const object = context.battlefield[0];

    expect(object.trackingEnabled).toBe(true);
    expect(object.depowerMode).toBe("all");
    expect(object.canBeEffectSource).toBe(false);
    expect(object.sourceUnavailableReason).toBe("depowered");
    expect(context.depoweredGroupIds).toEqual([object.groupId]);
    expect(context.trackingDisabledGroupIds).toEqual([]);
  });

  it("keeps generic placeholders as recipients and token stacks as grouped objects", () => {
    const token = createTokenGroup({
      name: "Soldier",
      quantity: 5,
      power: 1,
      toughness: 1,
      subtypes: ["Soldier"],
    });
    const field = normalizeField(fieldWith([genericCreature(2), token]));
    const context = createAthenaAwarenessContext(field, { timestamp });
    const generic = context.battlefield.find((entry) => entry.isGeneric);
    const tokenStack = context.battlefield.find((entry) => entry.isToken);

    expect(generic).toMatchObject({
      canBeEffectSource: false,
      canBeEffectRecipient: true,
      sourceUnavailableReason: "generic-placeholder",
      quantity: 2,
    });
    expect(tokenStack).toMatchObject({
      quantity: 5,
      isToken: true,
      sourceUnavailableReason: "quantity-only",
    });
    expect(context.tokenStackGroupIds).toContain(tokenStack?.groupId);
  });

  it("preserves stable object IDs and stack lineage for grouped objects", () => {
    const creature = genericCreature(4);
    const field = normalizeField(fieldWith([creature]));
    const context = createAthenaAwarenessContext(field, { timestamp });
    const object = context.battlefield[0];

    expect(object.objectIds).toEqual(field.groups[0].session?.objectIds);
    expect(object.lineage.objectIds).toEqual(object.objectIds);
    expect(context.relationships).toContainEqual(
      expect.objectContaining({
        kind: "stack-lineage",
        sourceGroupId: object.groupId,
      }),
    );
  });

  it("represents authority precedence honestly and never treats Lite previews as authoritative", () => {
    const comparison = compareAthenaAuthoritySources(
      "boardstate-authoritative-result",
      "lite-preview",
    );
    const settings = normalizeAthenaSettings({
      boardStateAuthorityConnected: true,
      directBattlefieldMutation: true,
      duplicateUndoStack: true,
      rulesAuthorityTransferred: true,
    });

    expect(comparison).toMatchObject({
      winner: "boardstate-authoritative-result",
      loser: "lite-preview",
      winningPrecedence: 1,
      losingPrecedence: 5,
      tied: false,
    });
    expect(settings).toMatchObject({
      boardStateAuthorityConnected: false,
      directBattlefieldMutation: false,
      duplicateUndoStack: false,
      rulesAuthorityTransferred: false,
    });
  });

  it("creates isolated preview metadata without mutating committed battlefield state", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const before = structuredClone(field);
    const context = createAthenaAwarenessContext(field, { timestamp });
    const preview = createAthenaPreview(context, {
      timestamp,
      summary: ["Anim Pakal consequence preview prepared."],
    });
    const state = recordAthenaPreview(createDefaultAthenaState(), preview);
    const cleared = clearAthenaPreview(state, "Preview rejected by test.");

    expect(preview).toMatchObject({
      status: "created",
      committedStateMutated: false,
      directBattlefieldMutation: false,
      fieldId: field.id,
    });
    expect(state.activePreview?.id).toBe(preview.id);
    expect(cleared.activePreview).toBeNull();
    expect(field).toEqual(before);
  });

  it("uses the existing undo and Ambient Event Pipeline boundaries for commits", () => {
    ambientEventPipeline.resetDiagnostics();
    const field = createDefaultField();
    const context = createAthenaAwarenessContext(field, { timestamp });
    const outcome = ambientEventPipeline.process({
      field,
      intent: {
        id: "athena-life-intent",
        kind: "modify-life",
        source: "manual",
        confidence: "high",
        payload: { amount: 1 },
      },
      mutation: ({ field: current }) => resolveSetLife(current, 41, "gain"),
      timestamp,
    });

    expect(context.undoBoundaryId).toBeNull();
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("Expected commit.");
    expect(outcome.historyEntry.before.player.life).toBe(40);
    expect(outcome.historyEntry.after.player.life).toBe(41);
    expect(outcome.undo.historyEntryId).toBe(outcome.historyEntry.id);
  });

  it("identifies unsupported effects without expanding card coverage", () => {
    const unsupported = tracked(
      testCard({
        name: "Unsupported Fixture",
        typeLine: "Creature - Wizard",
        oracleText: "Whenever you cast a spell, do a complicated thing.",
        supportStatus: "unsupported",
        power: "2",
        toughness: "2",
      }),
    );
    const context = createAthenaAwarenessContext(
      normalizeField(fieldWith([unsupported])),
      { timestamp },
    );

    expect(context.supportFindings).toContainEqual(
      expect.objectContaining({
        label: "Unsupported Fixture",
        status: "unsupported-effect",
        authorityRequired: true,
        manualResolutionRequired: true,
      }),
    );
    expect(context.supportedCardStatus.unsupported).toBe(1);
  });

  it("loads legacy saves without Athena metadata and rejects invalid Athena metadata safely", () => {
    const legacy = createDefaultField() as unknown as Partial<
      ReturnType<typeof createDefaultField>
    >;
    delete legacy.athena;
    legacy.settings = {
      ...legacy.settings,
      athena: undefined,
    } as unknown as ReturnType<typeof createDefaultField>["settings"];
    const imported = sanitizeImportedField(legacy);
    const unsafe = normalizeAthenaState(
      {
        activePreview: {
          id: "preview-1",
          fieldId: "field-1",
          sessionId: "session-1",
          fieldFingerprint: "stale",
          status: "ready",
        },
        diagnostics: {
          directBattlefieldMutation: true,
          duplicateBattlefieldState: true,
          boardStateAuthorityConnected: true,
        },
      } as unknown as AthenaState,
      { fallbackTimestamp: timestamp, allowActivePreview: false },
    );

    expect(imported).not.toBeNull();
    expect(imported?.athena.version).toBe(1);
    expect(imported?.settings.athena.localOnly).toBe(true);
    expect(unsafe.activePreview).toBeNull();
    expect(unsafe.diagnostics.lastInvalidationReason).toContain("discarded");
    expect(unsafe.diagnostics.directBattlefieldMutation).toBe(false);
  });

  it("integrates with Echo intents, rules-result rendering, Activate Field output, and snapshots", () => {
    const base = normalizeField(
      fieldWith([
        withCounters(tracked(animPakal()), { "+1/+1": 1 }),
        tracked(catharsCrusade()),
      ]),
    );
    const intent = createAmbientIntent(
      {
        id: "athena-echo-intent",
        kind: "attack",
        source: "voice-command",
        confidence: "high",
        payload: { originalTranscript: "Attack with Anim Pakal." },
      },
      timestamp,
    );
    const rendered = rulesResultRenderer.renderLiteHelperResult(
      base,
      resolveSetLife(base, 42, "gain"),
      { timestamp },
    );
    const context = createAthenaAwarenessContext(base, {
      timestamp,
      recentEchoIntent: intent,
      pendingRulesResult: rendered.result,
      recentCanonicalEventIds: rendered.result.events.map((event) => event.id),
    });
    const snapshot = createLiteFieldSnapshot(base);
    const refreshed = athenaCoordinator.refreshState(base.athena, base, {
      timestamp,
      recentEchoIntent: intent,
    });

    expect(context.recentEchoIntentId).toBe("athena-echo-intent");
    expect(context.pendingRulesResult?.source).toBe("lite-local-helper-result");
    expect(context.currentAuthoritySource).toBe("lite-local-helper-result");
    expect(snapshot.athena.diagnostics.directBattlefieldMutation).toBe(false);
    expect(refreshed.lastContext?.fieldId).toBe(base.id);
  });

  it("keeps transitionable preview lifecycle and reset state deterministic", () => {
    const field = createDefaultField();
    const context = createAthenaAwarenessContext(field, { timestamp });
    const ready = transitionAthenaPreview(
      createAthenaPreview(context, { timestamp }),
      "ready",
      "Analysis completed.",
      timestamp,
    );
    const restored = normalizeAthenaState(
      { activePreview: ready, recentPreviewIds: [ready.id] },
      { fallbackTimestamp: timestamp, allowActivePreview: true },
    );
    const reset = resetAthenaState({ timestamp });
    const diagnostics = getAthenaDiagnostics(restored, context);

    expect(restored.activePreview?.status).toBe("ready");
    expect(reset.activePreview).toBeNull();
    expect(diagnostics.pendingPreviewStatus).toBe("ready");
    expect(diagnostics.boardStateAuthorityConnected).toBe(false);
  });
});
