import { describe, expect, it } from "vitest";
import { createGenericGroup } from "../domain/cards";
import { createDefaultField, normalizeField } from "../domain/field";
import { parseEchoReconciliationCommand } from "./reconciliationCommand";

const timestamp = "2026-08-20T12:00:00.000Z";

describe("Echo structured reconciliation commands", () => {
  it.each([
    ["Correction, my life is 28.", "set-life", 28],
    ["Actually I have nine lands.", "set-relevant-total", 9],
    ["My life should be 31.", "set-life", 31],
  ])("recognizes %s as Correction Only", (transcript, kind, value) => {
    const result = parseEchoReconciliationCommand({
      transcript,
      field: createDefaultField(),
      speakerVerified: true,
      timestamp,
    });

    expect(result).toMatchObject({
      disposition: "correction",
      correctionOnly: true,
      speakerVerified: true,
    });
    expect(result.repairs[0]).toMatchObject({ kind, value });
  });

  it("parses Catch Me Up statements into one structured correction batch", () => {
    const treasure = createGenericGroup({
      kind: "Token",
      label: "Treasure",
      quantity: 4,
      token: true,
    });
    const field = normalizeField({
      ...createDefaultField(),
      groups: [treasure],
    });
    const result = parseEchoReconciliationCommand({
      transcript: "Catch me up. Nine lands, six Treasures, life 28.",
      field,
      speakerVerified: true,
      catchUpMode: true,
      timestamp,
    });

    expect(result.disposition).toBe("catch-me-up");
    expect(result.repairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "set-life", value: 28 }),
        expect.objectContaining({
          kind: "set-relevant-total",
          key: "lands",
          value: 9,
        }),
        expect.objectContaining({
          kind: "set-relevant-total",
          key: "treasureTokens",
          value: 6,
        }),
      ]),
    );
  });

  it("corrects named stack and counter quantities from structured text", () => {
    const swarm = createGenericGroup({
      kind: "Token",
      label: "Scute Swarm",
      quantity: 32,
      token: true,
    });
    const hydra = createGenericGroup({
      kind: "Creature",
      label: "Anim Pakal",
      quantity: 1,
    });
    const field = normalizeField({
      ...createDefaultField(),
      groups: [swarm, hydra],
    });
    const result = parseEchoReconciliationCommand({
      transcript:
        "Correction, Scute Swarm should be 40 and Anim Pakal has twelve counters.",
      field,
      speakerVerified: true,
      timestamp,
    });

    expect(result.repairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "set-group-quantity",
          groupId: swarm.id,
          value: 40,
        }),
        expect.objectContaining({
          kind: "set-counter",
          groupId: hydra.id,
          counter: "+1/+1",
          value: 12,
        }),
      ]),
    );
  });

  it("captures compact post-combat current-state repair without replaying combat", () => {
    const soldiers = createGenericGroup({
      kind: "Token",
      label: "Soldier",
      quantity: 5,
      token: true,
    });
    const field = normalizeField({
      ...createDefaultField(),
      groups: [soldiers],
    });
    const result = parseEchoReconciliationCommand({
      transcript: "Correction, life is 20 and I have three Soldiers.",
      field,
      speakerVerified: true,
      timestamp,
    });

    expect(result.repairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "set-life", value: 20 }),
        expect.objectContaining({
          kind: "set-group-quantity",
          groupId: soldiers.id,
          value: 3,
        }),
      ]),
    );
    expect(result.correctionOnly).toBe(true);
  });

  it("parses graveyard total and categorical composition without classifying unknown as Colorless", () => {
    const result = parseEchoReconciliationCommand({
      transcript: "Correction, graveyard total is 15 with eight creatures.",
      field: createDefaultField(),
      speakerVerified: true,
      timestamp,
    });

    expect(result.repairs).toContainEqual(
      expect.objectContaining({
        kind: "set-zone-composition",
        zone: "graveyard",
        physicalTotal: 15,
        categoryTotals: { creature: 8 },
      }),
    );
    expect(JSON.stringify(result.repairs)).not.toContain("colorless");
  });

  it("keeps real game action speech distinct from corrections", () => {
    const result = parseEchoReconciliationCommand({
      transcript: "Play Forest.",
      field: createDefaultField(),
      speakerVerified: true,
      timestamp,
    });

    expect(result).toMatchObject({
      disposition: "real-game-action",
      correctionOnly: false,
      repairs: [],
    });
  });

  it("requests the minimum clarification for an ambiguous missed action", () => {
    const result = parseEchoReconciliationCommand({
      transcript: "I forgot to record that I played Forest.",
      field: createDefaultField(),
      speakerVerified: true,
      timestamp,
    });

    expect(result).toMatchObject({
      disposition: "clarification-required",
      correctionOnly: false,
      semanticPrompt: "Correct the board only, or process the missed play?",
      repairs: [],
    });
  });

  it("does not apply another player's or low-confidence speech", () => {
    const result = parseEchoReconciliationCommand({
      transcript: "Correction, life is 28.",
      field: createDefaultField(),
      speakerVerified: false,
      timestamp,
    });

    expect(result).toMatchObject({
      disposition: "unrecognized",
      speakerVerified: false,
      repairs: [],
    });
  });

  it("opens Catch Me Up without changing state when no values were supplied", () => {
    const result = parseEchoReconciliationCommand({
      transcript: "Catch me up.",
      field: createDefaultField(),
      speakerVerified: true,
      timestamp,
    });

    expect(result).toMatchObject({
      disposition: "catch-me-up",
      correctionOnly: true,
      repairs: [],
    });
  });
});
