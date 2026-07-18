import type { FieldState } from "../domain/types";
import { normalizeModeState } from "../gameModes/state";
import {
  HUB_APPLICATION_ID,
  HUB_APPLICATION_NAME,
  HUB_BACKUP_VERSION,
  HUB_COMPATIBILITY_VERSION,
  HUB_EXPORT_VERSION,
  HUB_LITE_APP_VERSION,
  normalizeHubState,
} from "../hub";
import { normalizeMultiplayerState } from "../multiplayer/state";
import {
  SHARED_SESSION_COMPATIBILITY_VERSION,
  SHARED_SESSION_EXPORT_KIND,
  SHARED_SESSION_SERIALIZATION_VERSION,
  type SharedSessionMetadata,
  type SharedSessionExportEnvelope,
} from "./types";

export function createSessionExportEnvelope(
  field: FieldState,
  exportedAt = new Date().toISOString(),
): SharedSessionExportEnvelope {
  const mode = normalizeModeState(field.mode, {
    fallbackTimestamp: field.updatedAt,
  });
  const objectIds = field.groups.flatMap(
    (group) => group.session?.objectIds ?? [group.id],
  );
  const multiplayer = normalizeMultiplayerState(field.multiplayer, {
    session: field.session,
    fallbackTimestamp: field.updatedAt,
    objectIds,
  });
  const hub = normalizeHubState(field.hub, {
    fallbackTimestamp: field.updatedAt,
    settings: field.settings,
  });
  const exportedSession: SharedSessionMetadata = {
    ...field.session,
    liteAppVersion: HUB_LITE_APP_VERSION,
    status: "localOnly" as const,
    importExport: {
      ...field.session.importExport,
      exported: true,
      exportedAt,
    },
    ecosystem: {
      ...field.session.ecosystem,
      profileId: hub.profile.id,
      applicationOrigin: HUB_APPLICATION_ID as "boardstate-lite",
      applicationVersion: HUB_LITE_APP_VERSION,
      backupVersion: HUB_BACKUP_VERSION,
      exportVersion: HUB_EXPORT_VERSION,
      hubId: null,
      hubCompatibilityVersion: HUB_COMPATIBILITY_VERSION,
    },
  };
  return {
    kind: SHARED_SESSION_EXPORT_KIND,
    exportVersion: SHARED_SESSION_SERIALIZATION_VERSION,
    exportedAt,
    session: exportedSession,
    mode,
    multiplayer,
    hub,
    application: {
      id: HUB_APPLICATION_ID,
      name: HUB_APPLICATION_NAME,
      version: HUB_LITE_APP_VERSION,
      mode: mode.currentMode,
      rulesAuthority: exportedSession.currentRulesAuthority,
      sessionAuthority: exportedSession.currentSessionAuthority,
      compatibilityVersion: HUB_COMPATIBILITY_VERSION,
    },
    backup: {
      type: "local-json",
      status: "local-only",
      backupVersion: hub.backup.backupVersion,
      exportVersion: hub.backup.exportVersion,
      profileId: hub.profile.id,
      hubId: null,
    },
    authority: {
      rules: exportedSession.currentRulesAuthority,
      session: exportedSession.currentSessionAuthority,
      mode: "local-lite",
      multiplayer: "local-lite",
    },
    capabilities: {
      session: exportedSession.capabilities,
      simpleMode: mode.simple.capabilities,
      advancedMode: mode.advanced.capabilities,
      multiplayer: multiplayer.capabilities,
    },
    compatibility: mode.compatibility,
    field: {
      ...field,
      session: exportedSession,
      mode,
      multiplayer,
      hub,
    },
    futureCompatibilityVersion: SHARED_SESSION_COMPATIBILITY_VERSION,
    notes: [
      "Local Session export. BoardState authority and synchronization are not connected.",
    ],
  };
}

export function serializeSessionExport(field: FieldState): string {
  return JSON.stringify(
    sortSerializable(createSessionExportEnvelope(field)),
    null,
    2,
  );
}

export function unwrapSessionImport(value: unknown): {
  field: unknown;
  session: unknown;
  mode: unknown;
  multiplayer: unknown;
  hub: unknown;
  importedFromSessionEnvelope: boolean;
  unknownEnvelope: Record<string, unknown> | null;
} {
  if (
    value &&
    typeof value === "object" &&
    (value as Partial<SharedSessionExportEnvelope>).kind ===
      SHARED_SESSION_EXPORT_KIND &&
    "field" in value
  ) {
    const envelope = value as Partial<SharedSessionExportEnvelope> &
      Record<string, unknown>;
    return {
      field: envelope.field,
      session: envelope.session,
      mode: envelope.mode,
      multiplayer: envelope.multiplayer,
      hub: envelope.hub,
      importedFromSessionEnvelope: true,
      unknownEnvelope: envelope,
    };
  }
  return {
    field: value,
    session: null,
    mode: null,
    multiplayer: null,
    hub: null,
    importedFromSessionEnvelope: false,
    unknownEnvelope: null,
  };
}

function sortSerializable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortSerializable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortSerializable(entry)]),
  );
}
