import type { FieldState } from "../domain/types";
import { normalizeModeState } from "../gameModes/state";
import {
  SHARED_SESSION_COMPATIBILITY_VERSION,
  SHARED_SESSION_EXPORT_KIND,
  SHARED_SESSION_SERIALIZATION_VERSION,
  type SharedSessionExportEnvelope,
} from "./types";

export function createSessionExportEnvelope(
  field: FieldState,
  exportedAt = new Date().toISOString(),
): SharedSessionExportEnvelope {
  const mode = normalizeModeState(field.mode, {
    fallbackTimestamp: field.updatedAt,
  });
  const exportedSession = {
    ...field.session,
    status: "localOnly" as const,
    importExport: {
      ...field.session.importExport,
      exported: true,
      exportedAt,
    },
  };
  return {
    kind: SHARED_SESSION_EXPORT_KIND,
    exportVersion: SHARED_SESSION_SERIALIZATION_VERSION,
    exportedAt,
    session: exportedSession,
    mode,
    authority: {
      rules: exportedSession.currentRulesAuthority,
      session: exportedSession.currentSessionAuthority,
      mode: "local-lite",
    },
    capabilities: {
      session: exportedSession.capabilities,
      simpleMode: mode.simple.capabilities,
      advancedMode: mode.advanced.capabilities,
    },
    compatibility: mode.compatibility,
    field: {
      ...field,
      session: exportedSession,
      mode,
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
      importedFromSessionEnvelope: true,
      unknownEnvelope: envelope,
    };
  }
  return {
    field: value,
    session: null,
    mode: null,
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
