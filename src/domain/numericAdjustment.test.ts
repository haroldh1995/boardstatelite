import { describe, expect, it } from "vitest";
import {
  appendNumericAdjustment,
  numericAdjustmentValue,
} from "./numericAdjustment";

describe("grouped numeric adjustment", () => {
  it("accumulates repeated inputs into one transaction", () => {
    let transaction = appendNumericAdjustment(null, 40, -1, 0);
    for (let index = 1; index < 5; index += 1) {
      transaction = appendNumericAdjustment(transaction, 40, -1, index * 50);
    }
    expect(transaction.delta).toBe(-5);
    expect(numericAdjustmentValue(transaction)).toBe(35);
  });

  it("reports the net change when direction reverses", () => {
    let transaction = appendNumericAdjustment(null, 40, -5, 0);
    transaction = appendNumericAdjustment(transaction, 40, 2, 100);
    expect(transaction.delta).toBe(-3);
    expect(numericAdjustmentValue(transaction)).toBe(37);
  });
});
