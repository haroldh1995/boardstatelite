import { describe, expect, it } from "vitest";
import {
  canGenerateGameplayTriggers,
  compareGameplayAuthority,
  explicitPlayerProvenance,
  observationRequiresAcceptance,
} from "./actionSemantics";

describe("gameplay authority semantics", () => {
  it("places explicit player input above inferred rules expectations", () => {
    expect(
      compareGameplayAuthority("explicit-player-input", "athena-inference"),
    ).toBeGreaterThan(0);
    expect(
      compareGameplayAuthority(
        "battlefield-reconciliation",
        "single-source-observation",
      ),
    ).toBeGreaterThan(0);
  });

  it("allows game actions but never corrections to manufacture triggers", () => {
    expect(canGenerateGameplayTriggers(explicitPlayerProvenance())).toBe(true);
    expect(
      canGenerateGameplayTriggers(
        explicitPlayerProvenance("2026-09-26T00:00:00.000Z", "correction"),
      ),
    ).toBe(false);
  });

  it("confirms machine uncertainty instead of deliberate input", () => {
    expect(observationRequiresAcceptance("probable")).toBe(true);
    expect(observationRequiresAcceptance("uncertain")).toBe(true);
    expect(observationRequiresAcceptance("confirmed")).toBe(false);
  });
});
