import { describe, expect, it } from "vitest";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "./field";
import type { FieldState } from "./types";
import { genericCreature } from "../test/factories";

describe("Lite field persistence guardrails", () => {
  it("preserves unknown legacy field and group payloads during safe import", () => {
    const legacyCreature = {
      ...genericCreature(),
      legacyGroupPayload: { source: "pre-ecosystem-save" },
    };
    const legacyField = {
      ...createDefaultField(),
      groups: [legacyCreature],
      legacyRootPayload: { sharedSessionCandidate: "local-only" },
    };

    const imported = sanitizeImportedField(legacyField);
    expect(imported).not.toBeNull();
    const importedGroup = imported!.groups[0] as unknown as {
      legacyGroupPayload?: unknown;
    };

    expect(
      (imported as unknown as { legacyRootPayload?: unknown })
        .legacyRootPayload,
    ).toEqual({ sharedSessionCandidate: "local-only" });
    expect(importedGroup.legacyGroupPayload).toEqual({
      source: "pre-ecosystem-save",
    });
  });

  it("ignores inert future ecosystem metadata while preserving current Lite field behavior", () => {
    const fieldWithFutureMetadata = {
      ...createDefaultField(),
      boardStateAdapter: {
        status: "unavailable",
        reason: "original BoardState not connected",
      },
      hubStatus: "not-connected",
    } as unknown as FieldState;

    const normalized = normalizeField(fieldWithFutureMetadata);

    expect(normalized.player.life).toBe(40);
    expect(normalized.groups.length).toBeGreaterThan(0);
    expect(
      (normalized as unknown as { boardStateAdapter?: unknown })
        .boardStateAdapter,
    ).toEqual({
      status: "unavailable",
      reason: "original BoardState not connected",
    });
  });
});
