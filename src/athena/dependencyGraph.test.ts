import { describe, expect, it } from "vitest";
import {
  createGenericGroup,
  createTokenGroup,
  mergeCompatibleStacks,
  splitGroupForQuantity,
  withStackKey,
} from "../domain/cards";
import {
  applyCounters,
  replaceGenericIdentity,
  restoreTransformations,
  setTrackingEnabled,
  transformCreatures,
} from "../domain/engine";
import {
  calculateTotals,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import { createAmbientIntent } from "../echo";
import {
  animPakal,
  catharsCrusade,
  doublingSeason,
  fieldWith,
  genericCreature,
  rampagingBaloths,
  testCard,
  tracked,
  withCounters,
} from "../test/factories";
import {
  buildAthenaDependencyGraph,
  buildAthenaDependencyGraphFromContext,
  createAthenaAwarenessContext,
  createAthenaGraphQueryApi,
  detectAthenaGraphCycles,
  invalidateAthenaDependencyGraph,
  updateAthenaDependencyGraph,
} from "./index";
import type {
  AthenaDependencyGraph,
  AthenaGraphRelationship,
  AthenaGraphRelationshipType,
} from "./dependencyGraphTypes";

const timestamp = "2026-08-02T00:00:00.000Z";

function byType(
  graph: AthenaDependencyGraph,
  type: AthenaGraphRelationshipType,
): AthenaGraphRelationship[] {
  return graph.relationships.filter(
    (relationship) => relationship.type === type,
  );
}

function labels(relationships: AthenaGraphRelationship[]): string[] {
  return relationships.map((relationship) => relationship.label).sort();
}

describe("Athena personal battlefield dependency graph", () => {
  it("constructs typed nodes without duplicating persistent battlefield state", () => {
    const anim = tracked(animPakal());
    const equipment = tracked(
      testCard({
        name: "Swiftfoot Boots",
        typeLine: "Artifact - Equipment",
        oracleText: "Equipped creature has hexproof and haste.",
        supportStatus: "quantity-tracking-only",
      }),
    );
    const attached = withStackKey({
      ...equipment,
      attachedTo: anim.id,
    });
    const field = normalizeField(
      fieldWith([{ ...anim, attachments: [attached.id] }, attached]),
    );
    const before = structuredClone(field);
    const graph = buildAthenaDependencyGraph(field, { timestamp });

    expect(graph).toMatchObject({
      version: 1,
      cacheVersion: 1,
      fieldId: field.id,
      sessionId: field.session.id,
      committedStateReadOnly: true,
      derivedFromCanonicalState: true,
      directBattlefieldMutation: false,
      duplicateBattlefieldState: false,
    });
    expect(graph.nodes.some((node) => node.type === "battlefield-object")).toBe(
      true,
    );
    expect(graph.nodes.some((node) => node.type === "player-state")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "relevant-total")).toBe(
      true,
    );
    expect(graph.nodes.some((node) => node.type === "zone")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "event-category")).toBe(
      true,
    );
    expect(graph.nodes.some((node) => node.type === "effect-definition")).toBe(
      true,
    );
    expect(graph.nodes.some((node) => node.type === "counter-definition")).toBe(
      true,
    );
    expect(graph.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "attached-to",
          sourceGroupId: attached.id,
          targetGroupIds: [anim.id],
        }),
      ]),
    );
    expect(field).toEqual(before);
  });

  it("models overlapping relevant-total contributions with grouped quantities", () => {
    const equipment = tracked(
      testCard({
        name: "Colossus Hammer",
        typeLine: "Artifact - Equipment",
        oracleText: "Equipped creature gets +10/+10.",
        supportStatus: "quantity-tracking-only",
      }),
      2,
    );
    const artifactCreature = tracked(
      testCard({
        name: "Ornithopter",
        typeLine: "Artifact Creature - Thopter",
        oracleText: "Flying",
        power: "0",
        toughness: "2",
        supportStatus: "quantity-tracking-only",
      }),
      3,
    );
    const treasure = createGenericGroup({
      kind: "Token",
      label: "Treasure",
      quantity: 7,
      cardTypes: ["Artifact"],
      subtypes: ["Treasure"],
      token: true,
    });
    const god = tracked(
      testCard({
        name: "Heliod Fixture",
        typeLine: "Legendary Enchantment Creature - God",
        oracleText: "Indestructible.",
        power: "5",
        toughness: "5",
        supportStatus: "quantity-tracking-only",
      }),
    );
    const field = normalizeField(
      fieldWith([equipment, artifactCreature, treasure, god]),
    );
    const graph = buildAthenaDependencyGraph(field, { timestamp });
    const query = createAthenaGraphQueryApi(graph);
    const artifactContributors = query.getContributorsToTotal("artifacts");
    const equipmentContributors = query.getContributorsToTotal("equipment");
    const creatureContributors = query.getContributorsToTotal("creatures");
    const tokenContributors = query.getContributorsToTotal("tokens");

    expect(
      artifactContributors.reduce(
        (sum, relationship) => sum + relationship.quantity,
        0,
      ),
    ).toBe(12);
    expect(
      equipmentContributors.reduce(
        (sum, relationship) => sum + relationship.quantity,
        0,
      ),
    ).toBe(2);
    expect(
      creatureContributors.reduce(
        (sum, relationship) => sum + relationship.quantity,
        0,
      ),
    ).toBe(4);
    expect(
      tokenContributors.reduce(
        (sum, relationship) => sum + relationship.quantity,
        0,
      ),
    ).toBe(7);
    expect(calculateTotals(field.groups).artifacts).toBe(12);
    expect(calculateTotals(field.groups).legendaryPermanents).toBe(1);
  });

  it("indexes observers, replacements, static readers, and invalidation boundaries", () => {
    const artifactReader = tracked(
      testCard({
        name: "Artifact Reader",
        typeLine: "Creature - Construct",
        oracleText: "Artifact Reader gets +1/+1 for each artifact you control.",
        power: "1",
        toughness: "1",
        supportStatus: "partially-automated",
      }),
    );
    const graveyardReader = tracked(
      testCard({
        name: "Graveyard Reader",
        typeLine: "Creature - Spirit",
        oracleText:
          "Graveyard Reader gets +1/+1 for each card in your graveyard.",
        power: "1",
        toughness: "1",
        supportStatus: "partially-automated",
      }),
    );
    const field = normalizeField(
      fieldWith([
        tracked(catharsCrusade()),
        tracked(doublingSeason()),
        tracked(rampagingBaloths()),
        artifactReader,
        graveyardReader,
      ]),
    );
    const graph = buildAthenaDependencyGraph(field, { timestamp });
    const query = createAthenaGraphQueryApi(graph);

    expect(labels(query.getObserversForEvent("creature-entered"))).toEqual(
      expect.arrayContaining([expect.stringContaining("Cathars' Crusade")]),
    );
    expect(labels(query.getObserversForEvent("land-entered"))).toEqual(
      expect.arrayContaining([expect.stringContaining("Rampaging Baloths")]),
    );
    expect(labels(query.getModifiersForEvent("token-created"))).toEqual(
      expect.arrayContaining([expect.stringContaining("Doubling Season")]),
    );
    expect(labels(query.getStaticReadersForTotal("artifacts"))).toEqual(
      expect.arrayContaining([expect.stringContaining("Artifact Reader")]),
    );
    expect(labels(query.getStaticReadersForTotal("cardsInGraveyard"))).toEqual(
      expect.arrayContaining([expect.stringContaining("Graveyard Reader")]),
    );
    expect(
      invalidateAthenaDependencyGraph(graph, {
        kind: "relevant-total-changed",
        relevantTotals: ["artifacts"],
      }).affectedNodeIds,
    ).toEqual(
      expect.arrayContaining(
        query.getStaticReadersForTotal("artifacts").map((r) => r.from),
      ),
    );
  });

  it("keeps Not Tracked and Depower disabled relationships distinct", () => {
    const crusade = tracked(catharsCrusade());
    const season = tracked(doublingSeason());
    const field = normalizeField(
      fieldWith([
        withStackKey({ ...crusade, trackingEnabled: false }),
        withStackKey({
          ...season,
          abilitiesActive: false,
          depowerMode: "triggered",
          statuses: { ...season.statuses, depowered: true },
        }),
      ]),
    );
    const graph = buildAthenaDependencyGraph(field, { timestamp });
    const query = createAthenaGraphQueryApi(graph);

    expect(query.getRelationshipsDisabledByTracking()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceGroupId: crusade.id,
          disabledReason: "not-tracked",
        }),
      ]),
    );
    expect(query.getRelationshipsDisabledByDepower()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceGroupId: season.id,
          disabledReason: "depowered",
        }),
      ]),
    );
    expect(query.getContributorsToTotal("enchantments")).toHaveLength(2);
  });

  it("keeps generic placeholders as recipients without ability-source relationships", () => {
    const generic = genericCreature(3);
    const field = normalizeField(
      fieldWith([generic, tracked(catharsCrusade())]),
    );
    const graph = buildAthenaDependencyGraph(field, { timestamp });
    const genericRelationships = createAthenaGraphQueryApi(
      graph,
    ).getRelationshipsForObject(generic.id);

    expect(genericRelationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "contributes-to", enabled: true }),
        expect.objectContaining({ type: "affects", enabled: true }),
      ]),
    );
    expect(
      genericRelationships.some(
        (relationship) => relationship.type === "observes",
      ),
    ).toBe(false);
    expect(
      genericRelationships.some(
        (relationship) => relationship.type === "modifies",
      ),
    ).toBe(false);
  });

  it("updates attachment dependencies and invalidation sets for attach, detach, and host removal", () => {
    const host = tracked(animPakal());
    const equipment = tracked(
      testCard({
        name: "Sword Fixture",
        typeLine: "Artifact - Equipment",
        oracleText: "Equipped creature gets +1/+1.",
        supportStatus: "quantity-tracking-only",
      }),
    );
    const attached = withStackKey({ ...equipment, attachedTo: host.id });
    const attachedField = normalizeField(
      fieldWith([{ ...host, attachments: [attached.id] }, attached]),
    );
    const attachedGraph = buildAthenaDependencyGraph(attachedField, {
      timestamp,
    });
    const detachedGraph = buildAthenaDependencyGraph(
      normalizeField(fieldWith([host, equipment])),
      { timestamp },
    );
    const removedHostGraph = buildAthenaDependencyGraph(
      normalizeField(fieldWith([attached])),
      { timestamp },
    );

    expect(byType(attachedGraph, "attached-to")).toHaveLength(1);
    expect(byType(detachedGraph, "attached-to")).toHaveLength(0);
    expect(byType(removedHostGraph, "attached-to")[0]).toMatchObject({
      enabled: false,
      disabledReason: "missing-host",
      requiresManualResolution: true,
    });
    expect(
      invalidateAthenaDependencyGraph(attachedGraph, {
        kind: "attachment-removed",
        groupIds: [attached.id],
      }).affectedNodeIds,
    ).toEqual(expect.arrayContaining([expect.stringContaining(host.id)]));
  });

  it("preserves transformation identity continuity without inventing ETB events", () => {
    const anim = withCounters(tracked(animPakal()), { "+1/+1": 2 });
    const dreadmaw = testCard({
      name: "Colossal Dreadmaw",
      typeLine: "Creature - Dinosaur",
      oracleText: "Trample",
      power: "6",
      toughness: "6",
      supportStatus: "quantity-tracking-only",
    });
    const transformed = transformCreatures(
      normalizeField(fieldWith([anim])),
      dreadmaw,
      "all",
      [],
      false,
    ).field;
    const graph = buildAthenaDependencyGraph(transformed, { timestamp });
    const restored = restoreTransformations(transformed).field;

    expect(graph.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "derived-from",
          sourceGroupId: anim.id,
          eventCategories: ["permanent-transformed"],
          metadata: expect.objectContaining({ retroactiveEnter: false }),
        }),
      ]),
    );
    expect(
      graph.relationships.some(
        (relationship) =>
          relationship.eventCategories.includes("permanent-entered") &&
          relationship.sourceGroupId === anim.id,
      ),
    ).toBe(false);
    expect(restored.groups[0].id).toBe(anim.id);
    expect(restored.groups[0].counters["+1/+1"]).toBe(2);
  });

  it("represents token stack splits, merges, stale cleanup, and deterministic rebuilds", () => {
    const token = createTokenGroup({
      name: "Soldier",
      quantity: 5,
      power: 1,
      toughness: 1,
      subtypes: ["Soldier"],
    });
    const split = splitGroupForQuantity([token], token.id, 2);
    const splitGroups = split.groups.map((group) =>
      group.id === split.targetId
        ? withStackKey({ ...group, counters: { "+1/+1": 1 } })
        : group,
    );
    const splitField = normalizeField(fieldWith(splitGroups));
    const splitGraph = buildAthenaDependencyGraph(splitField, { timestamp });
    const mergedField = normalizeField(
      fieldWith(
        mergeCompatibleStacks([
          token,
          createTokenGroup({
            name: "Soldier",
            quantity: 2,
            power: 1,
            toughness: 1,
            subtypes: ["Soldier"],
          }),
        ]),
      ),
    );
    const mergedGraph = buildAthenaDependencyGraph(mergedField, { timestamp });

    expect(
      splitGraph.nodes.filter((node) => node.type === "battlefield-object"),
    ).toHaveLength(2);
    expect(byType(splitGraph, "derived-from").length).toBeGreaterThan(0);
    expect(
      mergedGraph.nodes.filter((node) => node.type === "battlefield-object"),
    ).toHaveLength(1);
    expect(
      buildAthenaDependencyGraph(splitField, { timestamp }).fingerprint,
    ).toBe(splitGraph.fingerprint);
  });

  it("adds future-active relationships after generic replacement without retroactive events", () => {
    const generic = genericCreature(2);
    const field = normalizeField(fieldWith([generic]));
    const card = catharsCrusade();
    const replaced = replaceGenericIdentity(
      field,
      generic.id,
      card,
      "all",
      2,
    ).field;
    const graph = buildAthenaDependencyGraph(replaced, { timestamp });
    const replacedGroup = replaced.groups.find(
      (group) => group.id === generic.id,
    );

    expect(replacedGroup).toMatchObject({
      id: generic.id,
      quantity: 2,
      isGeneric: false,
      label: "Cathars' Crusade",
    });
    expect(graph.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "observes",
          sourceGroupId: generic.id,
          eventCategories: ["creature-entered"],
        }),
      ]),
    );
    expect(
      graph.relationships.some((relationship) =>
        relationship.label.includes("retroactive"),
      ),
    ).toBe(false);
  });

  it("represents authority, unsupported, and local-helper metadata honestly", () => {
    const unsupported = tracked(
      testCard({
        name: "Unsupported Oracle Fixture",
        typeLine: "Enchantment",
        oracleText: "Whenever something complicated happens, do everything.",
        supportStatus: "unsupported",
      }),
    );
    const field = normalizeField(
      fieldWith([tracked(doublingSeason()), unsupported]),
    );
    const graph = buildAthenaDependencyGraph(field, {
      timestamp,
      authoritySource: "boardstate-authoritative-result",
    });
    const query = createAthenaGraphQueryApi(graph);
    const doublingRelationship = query
      .getModifiersForEvent("token-created")
      .find((relationship) => relationship.sourceGroupId !== unsupported.id);

    expect(graph.authoritySource).toBe("boardstate-authoritative-result");
    expect(doublingRelationship?.authoritySource).toBe(
      "lite-local-helper-result",
    );
    expect(query.getAuthorityRequiredRelationships()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceGroupId: unsupported.id,
          requiresAuthority: true,
        }),
      ]),
    );
    expect(query.getUnsupportedRelationships()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceGroupId: unsupported.id,
          support: "unsupported-effect",
        }),
      ]),
    );
  });

  it("keeps incremental updates equivalent to full rebuilds and returns minimal invalidation", () => {
    const field = normalizeField(
      fieldWith([tracked(catharsCrusade()), genericCreature(2)]),
    );
    const graph = buildAthenaDependencyGraph(field, { timestamp });
    const stopped = setTrackingEnabled(
      field,
      field.groups[0].id,
      false,
      "all",
      1,
    ).field;
    const updated = updateAthenaDependencyGraph(
      graph,
      stopped,
      {
        kind: "tracking-toggled",
        groupIds: [field.groups[0].id],
      },
      { timestamp },
    );
    const full = buildAthenaDependencyGraph(stopped, { timestamp });

    expect(updated.equivalentToFullRebuild).toBe(true);
    expect(updated.graph.fingerprint).toBe(full.fingerprint);
    expect(updated.invalidation.previewInvalidated).toBe(true);
    expect(updated.invalidation.affectedNodeIds).toEqual(
      expect.arrayContaining([expect.stringContaining(field.groups[0].id)]),
    );
  });

  it("restores equivalent graph identity after save, reload, undo, redo, import, and Echo query boundaries", () => {
    const field = normalizeField(
      fieldWith([tracked(animPakal()), tracked(catharsCrusade())]),
    );
    const counterResult = applyCounters(
      field,
      field.groups[0].id,
      "+1/+1",
      1,
      "all",
      1,
      "game-action",
    );
    const undoGraph = buildAthenaDependencyGraph(field, { timestamp });
    const redoGraph = buildAthenaDependencyGraph(counterResult.field, {
      timestamp,
    });
    const imported = sanitizeImportedField(
      JSON.parse(JSON.stringify(counterResult.field)),
    );
    const importedGraph = buildAthenaDependencyGraph(
      imported ?? counterResult.field,
      {
        timestamp,
      },
    );
    const intent = createAmbientIntent(
      {
        id: "athena-graph-intent",
        kind: "create-token",
        source: "voice-command",
        entities: [{ kind: "total", key: "tokens" }],
        confidence: "high",
      },
      timestamp,
    );
    const dependencies =
      createAthenaGraphQueryApi(redoGraph).getDependenciesForEchoIntent(intent);

    expect(undoGraph.fingerprint).not.toBe(redoGraph.fingerprint);
    expect(importedGraph.fingerprint).toBe(redoGraph.fingerprint);
    expect(dependencies.intentId).toBe("athena-graph-intent");
    expect(dependencies.eventCategories).toEqual(
      expect.arrayContaining(["token-created", "creature-entered"]),
    );
    expect(dependencies.observers.length).toBeGreaterThan(0);
  });

  it("handles large grouped battlefields and cycles without runaway recursion", () => {
    const groups = Array.from({ length: 60 }, (_, index) =>
      tracked(
        testCard({
          name: `Artifact Creature ${index}`,
          typeLine: "Artifact Creature - Construct",
          oracleText:
            "Artifact Creature gets +1/+1 for each artifact you control.",
          power: "1",
          toughness: "1",
          supportStatus: "partially-automated",
        }),
      ),
    );
    groups.push(
      createGenericGroup({
        kind: "Token",
        label: "Treasure",
        quantity: 5000,
        cardTypes: ["Artifact"],
        subtypes: ["Treasure"],
        token: true,
      }),
    );
    const field = normalizeField(fieldWith(groups));
    const started = performance.now();
    const graph = buildAthenaDependencyGraph(field, { timestamp });
    const duration = performance.now() - started;
    const cycles = detectAthenaGraphCycles(graph);

    expect(graph.diagnostics.nodeCount).toBeGreaterThan(60);
    expect(graph.diagnostics.relationshipCount).toBeGreaterThan(60);
    expect(graph.diagnostics.cycleCount).toBe(cycles.length);
    expect(duration).toBeLessThan(1000);
  });

  it("can build from ATHENA-01 awareness context and preserve graph/query contracts", () => {
    const field = normalizeField(
      fieldWith([tracked(rampagingBaloths()), tracked(doublingSeason())]),
    );
    const context = createAthenaAwarenessContext(field, { timestamp });
    const graph = buildAthenaDependencyGraph(field, { timestamp });
    const graphFromContext = buildAthenaDependencyGraphFromContext(context, {
      timestamp,
      field,
    });
    const query = createAthenaGraphQueryApi(graph);

    expect(context.fieldId).toBe(graph.fieldId);
    expect(graphFromContext.fingerprint).toBe(graph.fingerprint);
    expect(query.getObserversForEvent("land-entered")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceGroupId: field.groups[0].id }),
      ]),
    );
    expect(query.getModifiersForEvent("token-created")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceGroupId: field.groups[1].id }),
      ]),
    );
  });
});
