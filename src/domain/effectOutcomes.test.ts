import { describe, expect, it } from "vitest";
import { classifySupportedEffectOutcomes } from "./effectOutcomes";

describe("supported effect outcome classification", () => {
  it("classifies life changes without inventing tokens", () => {
    expect(classifySupportedEffectOutcomes("You gain 3 life.")).toEqual({
      status: "supported",
      outcomes: [{ kind: "life", mode: "gain", amount: 3 }],
      unsupportedClauses: [],
    });
    expect(
      classifySupportedEffectOutcomes("You lose 2 life.").outcomes,
    ).toEqual([{ kind: "life", mode: "lose", amount: 2 }]);
  });

  it("keeps multi-part token and life instructions separate", () => {
    const result = classifySupportedEffectOutcomes(
      "Whenever a creature enters, create a Treasure token. You gain 1 life.",
    );
    expect(result.status).toBe("supported");
    expect(result.outcomes).toEqual([
      expect.objectContaining({ kind: "token", name: "Treasure", quantity: 1 }),
      { kind: "life", mode: "gain", amount: 1 },
    ]);
  });

  it("classifies identical creature tokens as one quantity-aware outcome", () => {
    const result = classifySupportedEffectOutcomes(
      "Create three 1/1 white Soldier creature tokens.",
    );
    expect(result).toEqual({
      status: "supported",
      outcomes: [
        expect.objectContaining({
          kind: "token",
          quantity: 3,
          name: "Soldier",
          power: 1,
          toughness: 1,
          cardTypes: ["Creature"],
          subtypes: ["Soldier"],
          colors: ["W"],
        }),
      ],
      unsupportedClauses: [],
    });
  });

  it("requires manual resolution for unknown or conditional text", () => {
    expect(classifySupportedEffectOutcomes("Scry 1.")).toMatchObject({
      status: "manual-required",
      outcomes: [],
    });
    expect(
      classifySupportedEffectOutcomes(
        "Create a Treasure token for each creature you control.",
      ),
    ).toMatchObject({ status: "manual-required", outcomes: [] });
    expect(
      classifySupportedEffectOutcomes(
        "Whenever a creature an opponent controls enters, you gain 3 life.",
      ),
    ).toMatchObject({ status: "manual-required" });
  });
});
