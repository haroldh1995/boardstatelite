import { describe, expect, it } from "vitest";
import { activateField } from "../domain/engine";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import { createLiteFieldSnapshot } from "../rulesAdapter";
import { createSessionExportEnvelope } from "../sharedSession";
import { useFieldStore } from "../state/useFieldStore";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  testCard,
  tracked,
} from "../test/factories";
import {
  CLOUD_BACKUP_UNAVAILABLE_REASON,
  CROSS_APP_UNAVAILABLE_REASON,
  FRIENDS_UNAVAILABLE_REASON,
  HUB_APPLICATION_ID,
  HUB_APPLICATION_NAME,
  HUB_UNAVAILABLE_REASON,
  crossAppLaunchManager,
  hubIntegrationManager,
} from "./index";

describe("Hub-ready ecosystem integration architecture", () => {
  it("creates a standalone local profile without claiming Hub connectivity", () => {
    const field = createDefaultField();

    expect(field.hub.status).toBe("standalone");
    expect(field.hub.hubAvailability).toBe("unavailable");
    expect(field.hub.profile.id).toMatch(/^BS-PROFILE-/);
    expect(field.hub.profile.status).toBe("local-anonymous");
    expect(field.hub.profile.source).toBe("local");
    expect(field.hub.profile.connectedApplications).toEqual([
      HUB_APPLICATION_ID,
    ]);
    expect(field.hub.capabilities.localProfile).toBe(true);
    expect(field.hub.capabilities.localBackup).toBe(true);
    expect(field.hub.capabilities.manualBackup).toBe(true);
    expect(field.hub.capabilities.hubProfile).toBe(false);
    expect(field.hub.capabilities.friends).toBe(false);
    expect(field.hub.capabilities.cloudBackup).toBe(false);
    expect(field.hub.capabilities.crossAppLaunching).toBe(false);
    expect(field.session.ecosystem.profileId).toBe(field.hub.profile.id);
  });

  it("registers only BoardState Lite in the current application registry", () => {
    const registry = createDefaultField().hub.registry;

    expect(registry.applications).toHaveLength(1);
    expect(registry.applications[0]).toMatchObject({
      applicationId: HUB_APPLICATION_ID,
      displayName: HUB_APPLICATION_NAME,
      status: "standalone",
      authorityLevel: "local-lite",
      connectionStatusLabel: "Standalone Mode",
    });
    expect(registry.applications[0].capabilities.localProfile).toBe(true);
    expect(registry.applications[0].capabilities.rulesAuthority).toBe(false);
  });

  it("normalizes stale Hub-connected saves back to honest standalone state", () => {
    const field = createDefaultField();
    const stale = {
      ...field,
      hub: {
        ...field.hub,
        status: "connected" as const,
        hubAvailability: "available" as const,
        profile: {
          ...field.hub.profile,
          status: "hub-linked" as const,
          source: "hub" as const,
          preferencesSyncEnabled: true,
        },
        capabilities: {
          ...field.hub.capabilities,
          hubProfile: true,
          friends: true,
          cloudBackup: true,
          crossAppLaunching: true,
          deepLinks: true,
        },
        registry: {
          ...field.hub.registry,
          applications: [
            ...field.hub.registry.applications,
            {
              ...field.hub.registry.applications[0],
              applicationId: "boardstate-hub" as const,
              displayName: "BoardState Hub",
              status: "connected" as const,
            },
          ],
        },
        friends: {
          ...field.hub.friends,
          status: "available" as const,
        },
        notifications: {
          ...field.hub.notifications,
          status: "connected" as const,
        },
        backup: {
          ...field.hub.backup,
          status: "connected" as const,
          destinations: {
            ...field.hub.backup.destinations,
            hubBackup: true as const,
            cloudBackup: true as const,
          },
        },
        crossApp: {
          ...field.hub.crossApp,
          status: "available" as const,
        },
        deepLinks: {
          ...field.hub.deepLinks,
          status: "available" as const,
        },
      },
    };

    const normalized = normalizeField(
      stale as unknown as Parameters<typeof normalizeField>[0],
    );

    expect(normalized.hub.status).toBe("standalone");
    expect(normalized.hub.hubAvailability).toBe("unavailable");
    expect(normalized.hub.profile.status).toBe("local-anonymous");
    expect(normalized.hub.profile.source).toBe("local");
    expect(normalized.hub.profile.preferencesSyncEnabled).toBe(false);
    expect(normalized.hub.registry.applications).toHaveLength(1);
    expect(normalized.hub.registry.applications[0].applicationId).toBe(
      "boardstate-lite",
    );
    expect(normalized.hub.friends.status).toBe("unavailable");
    expect(normalized.hub.notifications.status).toBe("unavailable");
    expect(normalized.hub.backup.status).toBe("local-only");
    expect(normalized.hub.backup.destinations.cloudBackup).toBe(false);
    expect(normalized.hub.crossApp.status).toBe("unavailable");
    expect(normalized.hub.deepLinks.status).toBe("unavailable");
  });

  it("keeps friends, cloud backup, and cross-app launching as unavailable hooks", () => {
    expect(hubIntegrationManager.connectHub()).toEqual({
      ok: false,
      status: "unavailable",
      reason: HUB_UNAVAILABLE_REASON,
    });
    expect(hubIntegrationManager.fetchFriends()).toEqual({
      ok: false,
      status: "unavailable",
      reason: FRIENDS_UNAVAILABLE_REASON,
    });
    expect(hubIntegrationManager.backupToHub()).toEqual({
      ok: false,
      status: "unavailable",
      reason: CLOUD_BACKUP_UNAVAILABLE_REASON,
    });
    expect(hubIntegrationManager.launch("deck-nexus")).toEqual({
      ok: false,
      status: "unavailable",
      target: "deck-nexus",
      reason: CROSS_APP_UNAVAILABLE_REASON,
    });
    expect(
      crossAppLaunchManager.prepareDeepLink(
        "open-in-advanced",
        "boardstate-advanced",
      ),
    ).toMatchObject({
      ok: false,
      status: "unavailable",
      target: "boardstate-advanced",
      url: null,
    });
  });

  it("adds application, backup, and Hub metadata to local JSON exports", () => {
    const field = normalizeField(fieldWith([tracked(animPakal())]));
    const envelope = createSessionExportEnvelope(
      field,
      "2026-07-18T00:00:00.000Z",
    );
    const imported = sanitizeImportedField(envelope);

    expect(envelope.application).toMatchObject({
      id: "boardstate-lite",
      name: "Baord State Lite",
      mode: "simple",
      rulesAuthority: "local-lite",
      sessionAuthority: "local-lite",
    });
    expect(envelope.backup).toMatchObject({
      type: "local-json",
      status: "local-only",
      profileId: field.hub.profile.id,
      hubId: null,
    });
    expect(envelope.hub.status).toBe("standalone");
    expect(envelope.hub.profile.status).toBe("local-anonymous");
    expect(envelope.hub.capabilities.cloudBackup).toBe(false);
    expect(envelope.session.ecosystem.profileId).toBe(field.hub.profile.id);
    expect(imported?.hub.profile.id).toBe(field.hub.profile.id);
    expect(imported?.session.id).toBe(field.session.id);
    expect(imported?.hub.status).toBe("standalone");
  });

  it("migrates older saves without Hub metadata while preserving unknown fields", () => {
    const legacy = createDefaultField() as unknown as Record<string, unknown>;
    const originalFieldId = legacy.id;
    delete legacy.hub;
    legacy.legacyExtension = { keep: "future-safe" };

    const imported = sanitizeImportedField(legacy);

    expect(imported?.id).toBe(originalFieldId);
    expect(imported?.hub.status).toBe("standalone");
    expect(imported?.hub.profile.id).toMatch(/^BS-PROFILE-/);
    expect(imported?.session.ecosystem.profileId).toBe(
      imported?.hub.profile.id,
    );
    expect(
      (imported as unknown as { legacyExtension?: unknown }).legacyExtension,
    ).toEqual({ keep: "future-safe" });
  });

  it("includes Hub metadata in rules-adapter snapshots without Scryfall regressions", () => {
    const scryfallBacked = tracked({
      ...testCard({
        name: "Hub Snapshot Scryfall Fixture",
        typeLine: "Creature - Wizard",
        oracleText: "Whenever another creature enters, scry 1.",
        cardId: "hub-fixture-id",
        power: "2",
        toughness: "2",
      }),
      oracleId: "hub-oracle-fixture-id",
      setCode: "hbf",
      collectorNumber: "7",
    });
    const field = normalizeField(fieldWith([scryfallBacked]));
    const snapshot = createLiteFieldSnapshot(field);

    expect(snapshot.hub.status).toBe("standalone");
    expect(snapshot.hub.profile.id).toBe(field.hub.profile.id);
    expect(snapshot.hub.registry.applications).toHaveLength(1);
    expect(snapshot.hub.capabilities.localBackup).toBe(true);
    expect(snapshot.hub.capabilities.cloudBackup).toBe(false);
    expect(snapshot.battlefield[0].printing).toMatchObject({
      scryfallId: "hub-fixture-id",
      oracleId: "hub-oracle-fixture-id",
      setCode: "hbf",
      collectorNumber: "7",
    });
  });

  it("does not regress Activate Field, undo, redo, or local helper rendering", () => {
    const field = normalizeField(
      fieldWith([tracked(animPakal()), tracked(catharsCrusade())]),
    );
    const result = activateField(field);

    expect(result.field.hub.status).toBe("standalone");
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

    expect(useFieldStore.getState().field.hub.status).toBe("standalone");
    expect(
      useFieldStore
        .getState()
        .field.groups.find((group) => group.label === "Gnome")?.quantity,
    ).toBe(1);
    expect(useFieldStore.getState().lastResult?.rendering?.source).toBe(
      "lite-helper",
    );

    useFieldStore.getState().undo();
    expect(
      useFieldStore
        .getState()
        .field.groups.find((group) => group.label === "Gnome"),
    ).toBeUndefined();

    useFieldStore.getState().redo();
    expect(
      useFieldStore
        .getState()
        .field.groups.find((group) => group.label === "Gnome")?.quantity,
    ).toBe(1);
  });

  it("exposes developer diagnostics without fake Hub, cloud, friend, or launch claims", () => {
    const diagnostics = hubIntegrationManager.diagnostics(createDefaultField());

    expect(diagnostics).toMatchObject({
      status: "standalone",
      hubAvailable: false,
      profileStatus: "local-anonymous",
      friendStatus: "unavailable",
      notificationStatus: "unavailable",
      backupStatus: "local-only",
      crossAppStatus: "unavailable",
    });
    expect(diagnostics?.applicationRegistry).toHaveLength(1);
    expect(diagnostics?.capabilities.friends).toBe(false);
    expect(diagnostics?.capabilities.remoteNotifications).toBe(false);
    expect(diagnostics?.capabilities.cloudBackup).toBe(false);
    expect(diagnostics?.capabilities.crossAppLaunching).toBe(false);
  });
});
