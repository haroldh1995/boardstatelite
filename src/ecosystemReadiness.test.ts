import { describe, expect, it } from "vitest";
import { APP_ID, APP_NAME, APP_VERSION } from "./appMetadata";
import { activateField } from "./domain/engine";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "./domain/field";
import { modeManager } from "./gameModes";
import { hubIntegrationManager } from "./hub";
import { multiplayerParticipationManager } from "./multiplayer";
import {
  createLiteFieldSnapshot,
  rulesAdapterManager,
  serializeLiteFieldSnapshot,
} from "./rulesAdapter";
import { rulesResultRenderer } from "./rulesResult";
import {
  createSessionExportEnvelope,
  sharedSessionManager,
} from "./sharedSession";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  genericCreature,
  tracked,
  withCounters,
} from "./test/factories";

describe("final ecosystem readiness guardrails", () => {
  it("keeps every ecosystem subsystem in honest standalone mode by default", () => {
    const field = createDefaultField();

    expect(field.session).toMatchObject({
      status: "localOnly",
      currentRulesAuthority: "local-lite",
      currentSessionAuthority: "local-lite",
      liteAppVersion: APP_VERSION,
    });
    expect(field.mode.currentMode).toBe("simple");
    expect(field.mode.advanced.availability).toBe("unavailable");
    expect(field.multiplayer).toMatchObject({
      status: "localOnly",
      applicationType: APP_ID,
    });
    expect(field.multiplayer.registry.participants).toHaveLength(1);
    expect(field.hub).toMatchObject({
      status: "standalone",
      hubAvailability: "unavailable",
    });
    expect(field.hub.registry.applications).toHaveLength(1);
    expect(field.hub.registry.applications[0]).toMatchObject({
      applicationId: APP_ID,
      displayName: APP_NAME,
      status: "standalone",
      authorityLevel: "local-lite",
    });
    expect(field.hub.profile.status).toBe("local-anonymous");
    expect(field.hub.capabilities).toMatchObject({
      localProfile: true,
      localBackup: true,
      manualBackup: true,
      hubProfile: false,
      friends: false,
      cloudBackup: false,
      crossAppLaunching: false,
      rulesAuthority: false,
    });
  });

  it("preserves IDs and user battlefield data through normalize, export, import, undo-shaped snapshots, and snapshots", () => {
    const field = normalizeField(
      fieldWith([
        withCounters(tracked(animPakal()), { "+1/+1": 2, Shield: 1 }),
        genericCreature(3),
      ]),
    );
    const normalized = normalizeField(field);
    const envelope = createSessionExportEnvelope(
      normalized,
      "2026-07-18T12:00:00.000Z",
    );
    const imported = sanitizeImportedField(envelope);
    const snapshot = createLiteFieldSnapshot(normalized);
    const serializedFirst = serializeLiteFieldSnapshot(snapshot);
    const serializedSecond = serializeLiteFieldSnapshot(
      createLiteFieldSnapshot(normalized),
    );

    expect(imported).not.toBeNull();
    expect(imported?.session.id).toBe(normalized.session.id);
    expect(imported?.hub.profile.id).toBe(normalized.hub.profile.id);
    expect(imported?.groups.map((group) => group.quantity)).toEqual(
      normalized.groups.map((group) => group.quantity),
    );
    expect(
      imported?.groups.flatMap((group) => group.session?.objectIds),
    ).toEqual(normalized.groups.flatMap((group) => group.session?.objectIds));
    expect(envelope.application).toMatchObject({
      id: APP_ID,
      name: APP_NAME,
      version: APP_VERSION,
      mode: "simple",
    });
    expect(envelope.backup.status).toBe("local-only");
    expect(snapshot.metadata).toMatchObject({
      appName: APP_NAME,
      appVersion: APP_VERSION,
      fieldId: normalized.id,
    });
    expect(snapshot.session.metadata.id).toBe(normalized.session.id);
    expect(snapshot.hub.profile.id).toBe(normalized.hub.profile.id);
    expect(serializedFirst).toBe(serializedSecond);
  });

  it("falls back through the Lite helper and renderer without enabling unavailable authorities", () => {
    const field = normalizeField(
      fieldWith([tracked(animPakal()), tracked(catharsCrusade())]),
    );
    rulesAdapterManager.reset();
    const result = rulesAdapterManager.evaluateWithFallback(field, () =>
      activateField(field),
    );
    const rendered = rulesResultRenderer.renderLiteHelperResult(field, result);

    expect(
      rendered.result.field.groups.find((group) => group.label === "Gnome")
        ?.quantity,
    ).toBe(1);
    expect(rulesAdapterManager.getDiagnostics()).toMatchObject({
      status: "unavailable",
      currentEngine: "lite-helper",
    });
    expect(rulesResultRenderer.getDiagnostics()).toMatchObject({
      renderingSource: "lite-helper",
      authoritySource: "local-lite",
      validationStatus: "valid",
    });
  });

  it("keeps future hooks unavailable and non-networked", () => {
    const field = createDefaultField();

    expect(sharedSessionManager.connect()).toMatchObject({
      ok: false,
      status: "localOnly",
    });
    expect(modeManager.prepareAdvancedHandoff(field)).toMatchObject({
      ok: false,
      status: "advancedUnavailable",
    });
    expect(multiplayerParticipationManager.joinSession()).toMatchObject({
      ok: false,
      status: "unavailable",
    });
    expect(hubIntegrationManager.connectHub()).toMatchObject({
      ok: false,
      status: "unavailable",
    });
    expect(hubIntegrationManager.launch("boardstate-advanced")).toMatchObject({
      ok: false,
      status: "unavailable",
      target: "boardstate-advanced",
    });
    expect(
      hubIntegrationManager.prepareDeepLink("open-in-deck-nexus", "deck-nexus"),
    ).toMatchObject({
      ok: false,
      status: "unavailable",
      target: "deck-nexus",
      url: null,
    });
  });

  it("recovers corrupt or future metadata without turning on ecosystem services", () => {
    const field = createDefaultField();
    const hostile = {
      ...field,
      session: {
        ...field.session,
        currentRulesAuthority: "boardstate-authority",
        currentSessionAuthority: "boardstate-authority",
        status: "connected",
      },
      mode: {
        ...field.mode,
        currentMode: "advanced",
        advanced: {
          ...field.mode.advanced,
          availability: "available",
        },
      },
      multiplayer: {
        ...field.multiplayer,
        status: "connected",
      },
      hub: {
        ...field.hub,
        status: "connected",
        hubAvailability: "available",
      },
    };

    const normalized = normalizeField(
      hostile as unknown as Parameters<typeof normalizeField>[0],
    );

    expect(normalized.session.currentRulesAuthority).toBe("local-lite");
    expect(normalized.session.currentSessionAuthority).toBe("local-lite");
    expect(normalized.session.status).toBe("localOnly");
    expect(normalized.mode.currentMode).toBe("simple");
    expect(normalized.mode.advanced.availability).toBe("unavailable");
    expect(normalized.multiplayer.status).toBe("localOnly");
    expect(normalized.hub.status).toBe("standalone");
    expect(normalized.hub.hubAvailability).toBe("unavailable");
  });
});
