import { describe, expect, it, vi } from "vitest";
import { createTokenGroup } from "../domain/cards";
import { createDefaultField, normalizeField } from "../domain/field";
import type { FieldState } from "../domain/types";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  testCard,
  tracked,
} from "../test/factories";
import { AmbientEventPipeline } from "./ambientEventPipeline";
import { addPlannedAction } from "./preTurnPlanner";
import { synchronizeActionStripWithPlanner } from "./activeTurnActionStrip";
import {
  EchoEntityResolutionEngine,
  createBattlefieldContext,
  createDefaultEntityResolutionSettings,
  createDefaultEntityResolutionState,
  createEntityResolutionAmbientResolver,
  normalizeEntityResolutionSettings,
  normalizeEntityResolutionState,
  resolveEchoEntity,
  resolveEchoEntityWithFallback,
} from "./entityResolution";

describe("Echo entity resolution", () => {
  it("initializes dormant and persists local-only resolution metadata safely", () => {
    const settings = createDefaultEntityResolutionSettings();
    const state = createDefaultEntityResolutionState();
    const field = createDefaultField();

    expect(settings).toMatchObject({
      diagnosticsEnabled: false,
      cacheManagementPrepared: true,
      resolutionResetPrepared: true,
      scryfallFallbackEnabled: true,
      fuzzySearchEnabled: true,
    });
    expect(state.diagnostics.directBattlefieldMutation).toBe(false);
    expect(field.settings.voice.entityResolution).toMatchObject({
      diagnosticsEnabled: false,
      localCacheSize: 250,
    });
    expect(field.entityResolution.recentlyResolved).toEqual([]);

    expect(
      normalizeEntityResolutionSettings({
        diagnosticsEnabled: true,
        localCacheSize: -10,
        scryfallFallbackEnabled: false,
        fuzzySearchEnabled: false,
        cacheManagementPrepared: false,
        resolutionResetPrepared: false,
      }),
    ).toMatchObject({
      diagnosticsEnabled: true,
      localCacheSize: 50,
      scryfallFallbackEnabled: false,
      fuzzySearchEnabled: false,
      cacheManagementPrepared: true,
      resolutionResetPrepared: true,
    });
  });

  it("prioritizes battlefield objects and partial names before external lookup", async () => {
    const field = normalizeField(
      fieldWith([tracked(animPakal()), tracked(catharsCrusade())]),
    );
    const scryfallSearch = vi.fn();

    const result = await resolveEchoEntityWithFallback({
      field,
      text: "Anim",
      scryfallSearch,
    });

    expect(result.status).toBe("resolved");
    expect(result.selected?.label).toContain("Anim Pakal");
    expect(result.selected?.priority).toBe("battlefield");
    expect(result.resolvedEntities[0]).toMatchObject({
      kind: "group",
      id: field.groups[0].id,
    });
    expect(scryfallSearch).not.toHaveBeenCalled();
  });

  it("resolves commanders, token stacks, counters, players, zones, and mana without mutating the field", () => {
    const token = createTokenGroup({
      name: "Soldier",
      quantity: 4,
      power: 1,
      toughness: 1,
      subtypes: ["Soldier"],
    });
    const field = normalizeField(fieldWith([tracked(animPakal()), token]));
    const before = structuredClone(field);

    expect(resolveEchoEntity({ field, text: "my commander" })).toMatchObject({
      status: "resolved",
      selected: { kind: "commander" },
    });
    expect(resolveEchoEntity({ field, text: "the token" })).toMatchObject({
      status: "resolved",
      selected: { kind: "tokenStack", label: "Soldier" },
    });
    expect(resolveEchoEntity({ field, text: "+1/+1 counter" })).toMatchObject({
      status: "resolved",
      selected: { kind: "counter" },
    });
    expect(resolveEchoEntity({ field, text: "opponent" })).toMatchObject({
      status: "resolved",
      selected: { kind: "opponent" },
    });
    expect(resolveEchoEntity({ field, text: "graveyard" })).toMatchObject({
      status: "resolved",
      selected: { kind: "zone" },
    });
    expect(resolveEchoEntity({ field, text: "green mana" })).toMatchObject({
      status: "resolved",
      selected: { kind: "mana" },
    });
    expect(field).toEqual(before);
  });

  it("surfaces ambiguous repeated battlefield objects instead of guessing", () => {
    const first = tracked(
      testCard({
        name: "Soul Warden",
        typeLine: "Creature - Human Cleric",
        oracleText: "Whenever another creature enters, you gain 1 life.",
      }),
    );
    const second = tracked(
      testCard({
        name: "Soul Warden",
        typeLine: "Creature - Human Cleric",
        oracleText: "Whenever another creature enters, you gain 1 life.",
      }),
    );
    second.id = "group-second-soul-warden";
    second.counters = { Shield: 1 };
    const field = normalizeField(fieldWith([first, second]));

    const result = resolveEchoEntity({ field, text: "Soul Warden" });

    expect(result.status).toBe("ambiguous");
    expect(result.selected).toBeNull();
    expect(result.ambiguities[0]).toMatchObject({
      type: "multiple-battlefield-objects",
    });
    expect(result.resolvedEntities).toEqual([]);
  });

  it("exposes planner, action strip, recent object, and relationship context", () => {
    const anim = tracked(animPakal());
    const boots = tracked(
      testCard({
        name: "Swiftfoot Boots",
        typeLine: "Artifact - Equipment",
        oracleText: "Equipped creature has hexproof and haste.",
      }),
    );
    boots.attachedTo = anim.id;
    const field = withPlannerAndActionStrip(
      normalizeField(fieldWith([anim, boots])),
      anim.id,
    );

    const context = createBattlefieldContext(field, {
      timestamp: "2026-07-25T00:00:00.000Z",
    });

    expect(context.battlefield.map((entry) => entry.label)).toContain(
      "Anim Pakal, Thousandth Moon",
    );
    expect(context.plannerReferences[0]?.label).toContain("Attack");
    expect(context.actionStripReferences.length).toBeGreaterThan(0);
    expect(context.relationships.map((entry) => entry.kind)).toContain(
      "attached-to",
    );
    expect(
      resolveEchoEntity({
        field,
        text: "Attack with Anim",
      }).candidates.some((candidate) => candidate.priority === "planner"),
    ).toBe(true);
  });

  it("uses Scryfall only as an injected fallback when local context cannot resolve", async () => {
    const field = createDefaultField();
    const scryfallSearch = vi.fn(async () => [
      testCard({
        cardId: "scryfall-rhystic-study",
        name: "Rhystic Study",
        typeLine: "Enchantment",
        oracleText: "Whenever an opponent casts a spell, you may draw a card.",
      }),
    ]);

    const result = await resolveEchoEntityWithFallback({
      field,
      text: "Rhystic",
      scryfallSearch,
    });

    expect(scryfallSearch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("resolved");
    expect(result.selected).toMatchObject({
      source: "scryfall",
      label: "Rhystic Study",
    });
  });

  it("records recent selections and normalizes corrupt persisted resolver state", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const engine = new EchoEntityResolutionEngine();
    const result = engine.resolve({ field, text: "Anim" });

    expect(result.status).toBe("resolved");
    expect(engine.getState().recentlyResolved[0]).toMatchObject({
      label: "Anim Pakal, Thousandth Moon",
    });
    expect(
      normalizeEntityResolutionState(
        {
          recentlyResolved: [
            { id: "bad", label: 5, groupId: "missing", count: -3 },
            {
              id: "good",
              label: "Anim Pakal",
              normalizedLabel: "anim pakal",
              kind: "commander",
              groupId: field.groups[0].id,
              cardId: null,
              lastResolvedAt: "2026-07-25T00:00:00.000Z",
              count: 3,
            },
          ],
          localCache: [
            { id: "bad-cache", label: "Missing", groupId: "missing" },
          ],
          diagnostics: { directBattlefieldMutation: true },
        },
        { knownGroupIds: field.groups.map((group) => group.id) },
      ),
    ).toMatchObject({
      recentlyResolved: [{ id: "good" }],
      localCache: [],
      diagnostics: { directBattlefieldMutation: false },
    });
  });

  it("feeds unresolved spoken object text into the Ambient Event Pipeline resolver without direct mutation", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const pipeline = new AmbientEventPipeline();
    const result = pipeline.process({
      field,
      intent: {
        kind: "tap",
        source: "voice-command",
        actor: "you",
        confidence: "high",
        payload: { primaryObjectText: "Anim" },
      },
      resolver: createEntityResolutionAmbientResolver(),
      timestamp: "2026-07-25T00:00:00.000Z",
    });

    expect(result.event?.resolvedEntities[0]).toMatchObject({
      status: "resolved",
      groupId: field.groups[0].id,
    });
    expect(result.status).toBe("rejected");
    expect(result.field).toEqual(field);
  });
});

function withPlannerAndActionStrip(
  field: FieldState,
  groupId: string,
): FieldState {
  const preTurnPlanner = addPlannedAction(
    field.preTurnPlanner,
    {
      type: "planned-attack",
      title: "Attack with Anim Pakal",
      relatedGroupId: groupId,
      reminders: ["Remember attack trigger"],
    },
    "2026-07-25T00:00:00.000Z",
  );
  const activeTurnActionStrip = synchronizeActionStripWithPlanner(
    field.activeTurnActionStrip,
    {
      planner: preTurnPlanner,
      ambientMode: "activeTurn",
      timestamp: "2026-07-25T00:00:00.000Z",
      sessionId: field.session.id,
    },
  );
  return {
    ...field,
    preTurnPlanner,
    activeTurnActionStrip,
  };
}
