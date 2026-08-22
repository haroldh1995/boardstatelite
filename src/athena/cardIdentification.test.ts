import { beforeEach, describe, expect, it } from "vitest";
import { createGenericGroup } from "../domain/cards";
import { createDefaultField, normalizeField } from "../domain/field";
import { calculateTotals } from "../domain/field";
import { useFieldStore } from "../state/useFieldStore";
import { fieldWith, testCard, tracked } from "../test/factories";
import {
  classifyAthenaCardEntry,
  createStandaloneCardIdentificationAction,
  createUnspecifiedCardEntryDescriptor,
} from "./cardIdentification";
import {
  createAthenaForecastInput,
  createForecastEnvironment,
} from "./eventForecast";

describe("ATHENA unresolved card identification", () => {
  beforeEach(() => {
    useFieldStore.setState({
      field: normalizeField({ ...createDefaultField(), groups: [] }),
      hydrated: true,
      startupVisible: false,
      modal: null,
      lastResult: null,
      undoStack: [],
      redoStack: [],
    });
  });

  it("requests Scryfall only for an unspecified structured card entry", () => {
    const field = useFieldStore.getState().field;
    const unspecified = event(field, {
      identity: { kind: "unspecified-card" },
      reasonCode: "unspecified-card-entry",
    });
    expect(classifyAthenaCardEntry(field, unspecified).kind).toBe(
      "identification-required",
    );

    const namedCard = testCard({
      name: "Sol Ring",
      typeLine: "Artifact",
      oracleText: "{T}: Add {C}{C}.",
    });
    expect(
      classifyAthenaCardEntry(
        field,
        event(field, {
          identity: { kind: "named-card", card: namedCard },
          reasonCode: "exact-card-known",
        }),
      ).kind,
    ).toBe("resolved");
    expect(
      classifyAthenaCardEntry(
        field,
        event(field, {
          identity: { kind: "named-token", name: "Treasure" },
          reasonCode: "exact-token-known",
        }),
      ).kind,
    ).toBe("resolved");

    const source = tracked(namedCard);
    const copyField = fieldWith([source]);
    expect(
      classifyAthenaCardEntry(
        copyField,
        event(copyField, {
          identity: { kind: "copy-known-object", sourceGroupId: source.id },
          reasonCode: "known-copy",
        }),
      ).kind,
    ).toBe("resolved");

    expect(
      classifyAthenaCardEntry(
        field,
        event(field, {
          identity: { kind: "unsupported-oracle-text" },
          reasonCode: "unsupported-unstructured-effect",
        }),
      ).kind,
    ).toBe("manual-required");
  });

  it("persists one pending request and resolves it exactly once as ADD", () => {
    const initial = useFieldStore.getState().field;
    const unresolved = event(initial, {
      identity: { kind: "unspecified-card" },
      reasonCode: "unspecified-card-entry",
    });
    const pending = useFieldStore
      .getState()
      .processConfirmedAthenaEvent(unresolved);
    expect(pending.validity).toBe("identification-required");
    expect(pending.rootCanonicalEvent).toBeNull();
    const requestId =
      useFieldStore.getState().field.athena.cardIdentification.activeRequestId!;
    const soulWarden = testCard({
      name: "Soul Warden",
      typeLine: "Creature - Human Cleric",
      oracleText:
        "Whenever another creature enters the battlefield, you gain 1 life.",
    });
    const invalidCast = useFieldStore.getState().confirmScryfallCardAction({
      requestId,
      card: soulWarden,
      action: "cast",
    });
    expect(invalidCast.valid).toBe(false);
    expect(
      useFieldStore.getState().field.athena.cardIdentification.activeRequestId,
    ).toBe(requestId);
    const completed = useFieldStore.getState().confirmScryfallCardAction({
      requestId,
      card: soulWarden,
      action: "add",
    });
    expect(completed.valid).toBe(true);
    const field = useFieldStore.getState().field;
    expect(
      field.groups.some(
        (group) =>
          group.zone === "battlefield" &&
          group.identity?.name === "Soul Warden",
      ),
    ).toBe(true);
    expect(field.athena.cardIdentification.activeRequestId).toBeNull();
    expect(
      field.athena.cardIdentification.requests.find(
        (request) => request.id === requestId,
      )?.status,
    ).toBe("completed");
    expect(useFieldStore.getState().undoStack.at(-1)?.label).toBe(
      "Put Soul Warden onto battlefield",
    );

    const duplicate = useFieldStore.getState().confirmScryfallCardAction({
      requestId,
      card: soulWarden,
      action: "add",
    });
    expect(duplicate.valid).toBe(false);
    expect(
      useFieldStore
        .getState()
        .field.groups.filter((group) => group.identity?.name === "Soul Warden"),
    ).toHaveLength(1);
  });

  it("keeps CAST and ADD as distinct canonical paths", () => {
    const creature = testCard({
      name: "Test Adept",
      typeLine: "Creature - Wizard",
      oracleText: "",
    });
    const manualEvent = createAthenaForecastInput(
      {
        eventId: "manual-selected-card",
        eventCategory: "creature-entered",
        eventSource: "manual-report",
        authoritySource: "confirmed-user-report",
        timestamp: useFieldStore.getState().field.updatedAt,
        quantity: 1,
        permanentDefinition: creature,
        zoneDestination: "battlefield",
      },
      createForecastEnvironment(useFieldStore.getState().field),
    );
    const addDraft = createStandaloneCardIdentificationAction(
      useFieldStore.getState().field,
      manualEvent,
      creature,
      "add",
    );
    const castDraft = createStandaloneCardIdentificationAction(
      useFieldStore.getState().field,
      manualEvent,
      creature,
      "cast",
    );
    expect(addDraft.eventDrafts.map((event) => event.eventCategory)).toEqual([
      "creature-entered",
    ]);
    expect(castDraft.eventDrafts.map((event) => event.eventCategory)).toEqual([
      "spell-cast",
      "creature-entered",
    ]);
    const add = useFieldStore.getState().confirmScryfallCardAction({
      card: creature,
      action: "add",
    });
    expect(add.valid).toBe(true);
    expect(
      useFieldStore.getState().field.athena.liveTurn.processedCanonicalEventIds,
    ).toHaveLength(1);
    expect(useFieldStore.getState().undoStack.at(-1)?.label).toBe(
      "Put Test Adept onto battlefield",
    );

    useFieldStore.getState().undo();
    const cast = useFieldStore.getState().confirmScryfallCardAction({
      card: creature,
      action: "cast",
    });
    expect(cast.valid).toBe(true);
    expect(
      useFieldStore.getState().field.athena.liveTurn.processedCanonicalEventIds,
    ).toHaveLength(2);
    expect(useFieldStore.getState().undoStack.at(-1)?.label).toBe(
      "Cast Test Adept",
    );
    const history = useFieldStore.getState().undoStack.at(-1)!;
    expect(
      history.after.groups.some(
        (group) => group.identity?.name === "Test Adept",
      ),
    ).toBe(true);
    expect(history.summary[0]).toContain("Cast Test Adept");
  });

  it("preserves origin zone counts, category identity, and tapped status", () => {
    const unknown = createGenericGroup({
      kind: "Creature",
      label: "Unknown graveyard card",
      quantity: 2,
      zone: "graveyard",
    });
    const field = normalizeField({
      ...useFieldStore.getState().field,
      groups: [unknown],
    });
    useFieldStore.setState({ field });
    const unresolved = createAthenaForecastInput(
      {
        eventId: "graveyard-return",
        eventCategory: "creature-entered",
        eventSource: "canonical-event",
        authoritySource: "confirmed-user-report",
        timestamp: field.updatedAt,
        quantity: 1,
        zoneOrigin: "graveyard",
        zoneDestination: "battlefield",
        cardEntry: createUnspecifiedCardEntryDescriptor({
          actionPolicy: "add-only",
          originZone: "graveyard",
          cardTypes: ["Creature"],
          tapped: true,
          description: "Creature card from graveyard",
        }),
      },
      createForecastEnvironment(field),
    );
    useFieldStore.getState().processConfirmedAthenaEvent(unresolved);
    const requestId =
      useFieldStore.getState().field.athena.cardIdentification.activeRequestId!;
    const card = testCard({
      name: "Returned Sage",
      typeLine: "Creature - Elf Druid",
      oracleText: "",
      colors: ["G"],
    });
    const result = useFieldStore.getState().confirmScryfallCardAction({
      requestId,
      card,
      action: "add",
    });
    expect(result.valid, result.reason).toBe(true);
    const final = useFieldStore.getState().field;
    expect(calculateTotals(final.groups).cardsInGraveyard).toBe(1);
    const entered = final.groups.find(
      (group) => group.identity?.name === "Returned Sage",
    );
    expect(entered?.zone).toBe("battlefield");
    expect(entered?.statuses.tapped).toBe(true);
    expect(useFieldStore.getState().undoStack.at(-1)?.label).toBe(
      "Put Returned Sage onto battlefield",
    );
  });

  it("rejects a nonpermanent ADD without corrupting the battlefield", () => {
    const instant = testCard({
      name: "Test Instant",
      typeLine: "Instant",
      oracleText: "Draw a card.",
    });
    const before = useFieldStore.getState().field.groups;
    const result = useFieldStore.getState().confirmScryfallCardAction({
      card: instant,
      action: "add",
    });
    expect(result.valid).toBe(false);
    expect(useFieldStore.getState().field.groups).toEqual(before);
  });

  it("restores pending identification and preserves ADD through undo and redo", () => {
    const initial = useFieldStore.getState().field;
    const unresolved = event(initial, {
      identity: { kind: "unspecified-card" },
      reasonCode: "unspecified-card-entry",
    });
    useFieldStore.getState().processConfirmedAthenaEvent(unresolved);
    const restored = normalizeField(
      JSON.parse(JSON.stringify(useFieldStore.getState().field)),
    );
    expect(restored.athena.cardIdentification.activeRequestId).not.toBeNull();
    expect(
      restored.athena.cardIdentification.requests[0]?.constraints
        .maximumManaValue,
    ).toBeNull();
    expect(
      restored.athena.cardIdentification.requests[0]?.constraints
        .minimumManaValue,
    ).toBeNull();
    useFieldStore.setState({ field: restored });
    useFieldStore.getState().processConfirmedAthenaEvent(unresolved);
    expect(restored.athena.cardIdentification.requests).toHaveLength(1);

    const requestId =
      useFieldStore.getState().field.athena.cardIdentification.activeRequestId!;
    const card = testCard({
      name: "Persistent Creature",
      typeLine: "Creature - Test",
      oracleText: "",
    });
    expect(
      useFieldStore.getState().confirmScryfallCardAction({
        requestId,
        card,
        action: "add",
      }).valid,
    ).toBe(true);
    useFieldStore.getState().undo();
    expect(
      useFieldStore
        .getState()
        .field.groups.some(
          (group) => group.identity?.name === "Persistent Creature",
        ),
    ).toBe(false);
    expect(
      useFieldStore.getState().field.athena.cardIdentification.activeRequestId,
    ).toBe(requestId);
    useFieldStore.getState().redo();
    expect(
      useFieldStore
        .getState()
        .field.groups.some(
          (group) => group.identity?.name === "Persistent Creature",
        ),
    ).toBe(true);
    expect(
      useFieldStore
        .getState()
        .field.athena.cardIdentification.requests.find(
          (request) => request.id === requestId,
        )?.selectedAction,
    ).toBe("add");
  });

  it.each(["library", "hand", "exile"] as const)(
    "moves an identified card from %s without fabricating another source card",
    (zone) => {
      const unknown = createGenericGroup({
        kind: "Custom",
        label: `Unknown ${zone} cards`,
        quantity: 2,
        zone,
      });
      const field = normalizeField({
        ...useFieldStore.getState().field,
        groups: [unknown],
      });
      useFieldStore.setState({ field });
      const unresolved = createAthenaForecastInput(
        {
          eventId: `${zone}-entry`,
          eventCategory: "permanent-entered",
          eventSource: "canonical-event",
          authoritySource: "confirmed-user-report",
          timestamp: field.updatedAt,
          quantity: 1,
          zoneOrigin: zone,
          zoneDestination: "battlefield",
          cardEntry: createUnspecifiedCardEntryDescriptor({
            actionPolicy: "add-only",
            originZone: zone,
            permanentOnly: true,
          }),
        },
        createForecastEnvironment(field),
      );
      useFieldStore.getState().processConfirmedAthenaEvent(unresolved);
      const requestId =
        useFieldStore.getState().field.athena.cardIdentification
          .activeRequestId!;
      const card = testCard({
        name: `${zone} Permanent`,
        typeLine: "Artifact",
        oracleText: "",
      });
      expect(
        useFieldStore.getState().confirmScryfallCardAction({
          requestId,
          card,
          action: "add",
        }).valid,
      ).toBe(true);
      const final = useFieldStore.getState().field;
      expect(
        final.groups
          .filter((group) => group.zone === zone)
          .reduce((sum, group) => sum + group.quantity, 0),
      ).toBe(1);
      expect(
        final.groups.filter((group) => group.identity?.cardId === card.cardId),
      ).toHaveLength(1);
    },
  );

  it("casts from exile through a cast event before permanent entry", () => {
    const unknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown exiled card",
      quantity: 1,
      zone: "exile",
    });
    const field = normalizeField({
      ...useFieldStore.getState().field,
      groups: [unknown],
    });
    useFieldStore.setState({ field });
    const unresolved = createAthenaForecastInput(
      {
        eventId: "cast-from-exile",
        eventCategory: "permanent-entered",
        eventSource: "canonical-event",
        authoritySource: "confirmed-user-report",
        timestamp: field.updatedAt,
        quantity: 1,
        zoneOrigin: "exile",
        zoneDestination: "battlefield",
        cardEntry: createUnspecifiedCardEntryDescriptor({
          actionPolicy: "cast-only",
          originZone: "exile",
          permanentOnly: false,
        }),
      },
      createForecastEnvironment(field),
    );
    useFieldStore.getState().processConfirmedAthenaEvent(unresolved);
    const requestId =
      useFieldStore.getState().field.athena.cardIdentification.activeRequestId!;
    const card = testCard({
      name: "Exiled Creature",
      typeLine: "Creature - Test",
      oracleText: "",
    });
    expect(
      useFieldStore.getState().confirmScryfallCardAction({
        requestId,
        card,
        action: "add",
      }).valid,
    ).toBe(false);
    expect(
      useFieldStore.getState().confirmScryfallCardAction({
        requestId,
        card,
        action: "cast",
      }).valid,
    ).toBe(true);
    const final = useFieldStore.getState().field;
    expect(final.groups.some((group) => group.zone === "exile")).toBe(false);
    expect(
      final.groups.some(
        (group) =>
          group.zone === "battlefield" &&
          group.identity?.name === "Exiled Creature",
      ),
    ).toBe(true);
    expect(useFieldStore.getState().undoStack.at(-1)?.label).toBe(
      "Cast Exiled Creature",
    );
  });
});

function event(
  field: ReturnType<typeof createDefaultField>,
  identity: Parameters<
    typeof createUnspecifiedCardEntryDescriptor
  >[0] extends never
    ? never
    : {
        identity:
          | { kind: "unspecified-card" }
          | { kind: "named-card"; card: ReturnType<typeof testCard> }
          | { kind: "named-token"; name: string }
          | { kind: "copy-known-object"; sourceGroupId: string }
          | { kind: "unsupported-oracle-text" };
        reasonCode:
          | "unspecified-card-entry"
          | "exact-card-known"
          | "exact-token-known"
          | "known-copy"
          | "unsupported-unstructured-effect";
      },
) {
  return createAthenaForecastInput(
    {
      eventId: `entry:${identity.reasonCode}`,
      eventCategory: "permanent-entered",
      eventSource: "canonical-event",
      authoritySource: "confirmed-user-report",
      timestamp: field.updatedAt,
      quantity: 1,
      zoneDestination: "battlefield",
      cardEntry: {
        ...createUnspecifiedCardEntryDescriptor({
          actionPolicy: "add-only",
        }),
        identity: identity.identity,
        reasonCode: identity.reasonCode,
      },
    },
    createForecastEnvironment(field),
  );
}
