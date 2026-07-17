import { describe, expect, it } from "vitest";
import { activateField } from "../domain/engine";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import { createLiteFieldSnapshot } from "../rulesAdapter";
import { createSessionExportEnvelope } from "../sharedSession";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  testCard,
  tracked,
} from "../test/factories";
import {
  MULTIPLAYER_UNAVAILABLE_REASON,
  MultiplayerParticipationManager,
  multiplayerParticipationManager,
} from "./index";

describe("mixed Lite / Advanced multiplayer architecture", () => {
  it("creates one local BoardState Lite participant with local authority", () => {
    const field = createDefaultField();
    const participant = field.multiplayer.registry.participants[0];

    expect(field.multiplayer.status).toBe("localOnly");
    expect(field.multiplayer.applicationType).toBe("boardstate-lite");
    expect(field.multiplayer.registry.participants).toHaveLength(1);
    expect(participant.applicationType).toBe("boardstate-lite");
    expect(participant.role).toBe("lite-user");
    expect(participant.authorityLevel).toBe("local-lite");
    expect(participant.connectionState).toBe("local");
    expect(participant.compatibilityStatus).toBe("compatible");
    expect(field.multiplayer.authority).toEqual({
      current: "local-lite",
      rules: "local-lite",
      session: "local-lite",
      judge: "unknown",
    });
  });

  it("persists local participant identity and ownership through normalization", () => {
    const field = normalizeField(
      fieldWith([tracked(animPakal()), tracked(catharsCrusade())]),
    );
    const participant = field.multiplayer.registry.participants[0];
    const objectIds = field.groups.flatMap(
      (group) => group.session?.objectIds ?? [],
    );
    const normalized = normalizeField(field);

    expect(normalized.multiplayer.registry.localParticipantId).toBe(
      participant.id,
    );
    expect(
      normalized.multiplayer.registry.participants[0].ownership.objectIds,
    ).toEqual(objectIds);
    expect(normalized.session.participants[0].ownership.objectIds).toEqual(
      objectIds,
    );
  });

  it("migrates older saves without multiplayer metadata safely", () => {
    const legacy = createDefaultField() as unknown as Record<string, unknown>;
    delete legacy.multiplayer;

    const imported = sanitizeImportedField(legacy);

    expect(imported?.multiplayer.status).toBe("localOnly");
    expect(imported?.multiplayer.registry.participants).toHaveLength(1);
    expect(imported?.multiplayer.registry.participants[0].applicationType).toBe(
      "boardstate-lite",
    );
  });

  it("normalizes stale remote participants and connected state back to local-only runtime", () => {
    const field = {
      ...createDefaultField(),
      multiplayer: {
        ...createDefaultField().multiplayer,
        status: "connected" as const,
        capabilities: {
          ...createDefaultField().multiplayer.capabilities,
          multiplayer: true,
          sharedBattlefield: true,
          judgeActions: true,
        },
        registry: {
          localParticipantId: "remote",
          participants: [
            {
              ...createDefaultField().multiplayer.registry.participants[0],
              id: "remote",
              role: "advanced-user" as const,
              applicationType: "boardstate-advanced" as const,
              capabilities: {
                ...createDefaultField().multiplayer.registry.participants[0]
                  .capabilities,
                multiplayer: true,
                sharedBattlefield: true,
              },
              connectionState: "connected" as const,
            },
          ],
        },
      },
    };

    const normalized = normalizeField(field);

    expect(normalized.multiplayer.status).toBe("localOnly");
    expect(normalized.multiplayer.registry.participants).toHaveLength(1);
    expect(
      normalized.multiplayer.registry.participants[0].applicationType,
    ).toBe("boardstate-lite");
    expect(normalized.multiplayer.registry.participants[0].role).toBe(
      "lite-user",
    );
    expect(
      normalized.multiplayer.registry.participants[0].connectionState,
    ).toBe("local");
    expect(normalized.multiplayer.capabilities.multiplayer).toBe(false);
    expect(normalized.multiplayer.capabilities.sharedBattlefield).toBe(false);
    expect(
      normalized.multiplayer.registry.participants[0].capabilities
        .sharedBattlefield,
    ).toBe(false);
  });

  it("adds visibility, synchronization, and authority metadata to object snapshots", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const group = field.groups[0];
    const snapshot = createLiteFieldSnapshot(field);
    const permanent = snapshot.battlefield[0];

    expect(group.session).toMatchObject({
      visibility: "localOnly",
      synchronizationState: "localOnly",
      authoritySource: "local-lite",
    });
    expect(permanent).toMatchObject({
      visibility: "localOnly",
      synchronizationState: "localOnly",
      authoritySource: "local-lite",
      ownerParticipantId: field.multiplayer.registry.localParticipantId,
      controllerParticipantId: field.multiplayer.registry.localParticipantId,
    });
    expect(snapshot.multiplayer.status).toBe("localOnly");
    expect(snapshot.multiplayer.registry.participants).toHaveLength(1);
  });

  it("reports multiplayer capabilities unavailable while preserving compatibility metadata", () => {
    const field = createDefaultField();

    expect(field.multiplayer.capabilities.rulesAuthority).toBe(false);
    expect(field.multiplayer.capabilities.sharedBattlefield).toBe(false);
    expect(field.multiplayer.capabilities.judgeActions).toBe(false);
    expect(field.multiplayer.capabilities.sharedChat).toBe(false);
    expect(field.multiplayer.compatibility.status).toBe("compatible");
    expect(field.multiplayer.synchronization.state).toBe("localOnly");
    expect(field.multiplayer.conflict.strategy).toBe("authorityWins");
    expect(field.multiplayer.discovery.available).toBe(false);
  });

  it("keeps synchronization, discovery, and conflict hooks inert", () => {
    const manager = new MultiplayerParticipationManager();

    expect(manager.joinSession()).toEqual({
      ok: false,
      status: "unavailable",
      reason: MULTIPLAYER_UNAVAILABLE_REASON,
    });
    expect(manager.publishBattlefield().ok).toBe(false);
    expect(manager.receiveBattlefield().ok).toBe(false);
    expect(manager.resolveConflict().ok).toBe(false);
    expect(manager.heartbeat().ok).toBe(false);
    expect(manager.exchangeCapabilities().ok).toBe(false);
    expect(manager.discoverApplications().ok).toBe(false);
  });

  it("includes multiplayer metadata in exports and imports it as Local Only", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const envelope = createSessionExportEnvelope(
      field,
      "2026-07-16T00:00:00.000Z",
    );
    const imported = sanitizeImportedField(envelope);

    expect(envelope.multiplayer.status).toBe("localOnly");
    expect(envelope.authority.multiplayer).toBe("local-lite");
    expect(envelope.capabilities.multiplayer.sharedBattlefield).toBe(false);
    expect(imported?.multiplayer.status).toBe("localOnly");
    expect(imported?.multiplayer.registry.participants).toHaveLength(1);
    expect(imported?.session.id).toBe(field.session.id);
  });

  it("does not regress Activate Field or Scryfall-backed identity snapshots", () => {
    const scryfallBacked = tracked({
      ...testCard({
        name: "Scryfall Identity Fixture",
        typeLine: "Creature - Wizard",
        oracleText: "Whenever another creature enters, scry 1.",
        cardId: "scryfall-fixture-id",
        power: "2",
        toughness: "2",
      }),
      oracleId: "oracle-fixture-id",
      setCode: "tst",
      collectorNumber: "1",
    });
    const field = normalizeField(
      fieldWith([
        tracked(animPakal()),
        tracked(catharsCrusade()),
        scryfallBacked,
      ]),
    );
    const result = activateField(field);
    const snapshot = createLiteFieldSnapshot(result.field);

    expect(
      result.field.groups.find((group) => group.label === "Gnome")?.quantity,
    ).toBe(1);
    expect(result.field.multiplayer.status).toBe("localOnly");
    expect(
      snapshot.battlefield.find(
        (group) => group.cardIdentity?.name === "Scryfall Identity Fixture",
      )?.printing,
    ).toMatchObject({
      scryfallId: "scryfall-fixture-id",
      oracleId: "oracle-fixture-id",
      setCode: "tst",
      collectorNumber: "1",
    });
  });

  it("exposes developer diagnostics without claiming multiplayer availability", () => {
    const diagnostics =
      multiplayerParticipationManager.diagnostics(createDefaultField());

    expect(diagnostics).toMatchObject({
      status: "localOnly",
      participantCount: 1,
      applicationType: "boardstate-lite",
      multiplayerAvailable: false,
      synchronizationAvailable: false,
    });
  });
});
