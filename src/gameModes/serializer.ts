import type { FieldState } from "../domain/types";
import { createLiteFieldSnapshot } from "../rulesAdapter";
import { createSessionSnapshot } from "../sharedSession";
import {
  createModeCompatibility,
  createModeSnapshot,
  normalizeModeState,
} from "./state";
import type { CanonicalHandoffSnapshot } from "./types";
import { MODE_HANDOFF_KIND, MODE_HANDOFF_VERSION } from "./types";

export function createCanonicalHandoffSnapshot(
  field: FieldState,
  createdAt = new Date().toISOString(),
): CanonicalHandoffSnapshot {
  const mode = normalizeModeState(field.mode, {
    fallbackTimestamp: field.updatedAt,
  });
  return {
    kind: MODE_HANDOFF_KIND,
    version: MODE_HANDOFF_VERSION,
    createdAt,
    mode: createModeSnapshot(mode),
    session: createSessionSnapshot(field.session),
    liteSnapshot: createLiteFieldSnapshot({
      ...field,
      mode,
    }),
    compatibility: createModeCompatibility(createdAt),
    authority: {
      current: "local-lite",
      requested: "boardstate-advanced",
      transferSupported: false,
    },
    lockState: "unlocked",
    notes: [
      "Simple Mode snapshot prepared locally. BoardState Advanced handoff is unavailable until a real destination is configured.",
    ],
  };
}

export function serializeCanonicalHandoffSnapshot(
  snapshot: CanonicalHandoffSnapshot,
): string {
  return JSON.stringify(sortSerializable(snapshot));
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
