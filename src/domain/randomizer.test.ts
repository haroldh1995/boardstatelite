import { describe, expect, it } from "vitest";
import type { RandomNumberSource } from "./randomizer";
import {
  createDefaultRandomizerState,
  flipCoins,
  recordRandomizerResult,
  rollDice,
} from "./randomizer";

function sequence(values: number[]): RandomNumberSource {
  let index = 0;
  return { integer: () => values[index++] ?? values.at(-1) ?? 1 };
}

describe("randomizer domain", () => {
  it("determines dice outcomes independently of animation", () => {
    const result = rollDice(2, 6, sequence([2, 5]));
    expect(result.values).toEqual([2, 5]);
    expect(result.total).toBe(7);
  });

  it("supports multiple canonical coin results", () => {
    const result = flipCoins(3, sequence([0, 1, 0]), {
      source: "effect-requested",
    });
    expect(result.values).toEqual(["Heads", "Tails", "Heads"]);
    expect(result.source).toBe("effect-requested");
  });

  it("records one shared result rather than rerolling for each client", () => {
    const result = rollDice(1, 20, sequence([17]));
    const state = recordRandomizerResult(
      createDefaultRandomizerState(),
      result,
    );
    const restored = JSON.parse(JSON.stringify(state));
    expect(restored.latest.id).toBe(result.id);
    expect(restored.latest.values).toEqual([17]);
  });
});
