import type { FieldState } from "../domain/types";
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
    field: {
      ...field,
      session: exportedSession,
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
      importedFromSessionEnvelope: true,
      unknownEnvelope: envelope,
    };
  }
  return {
    field: value,
    session: null,
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
