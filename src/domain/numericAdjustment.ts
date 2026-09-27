export interface NumericAdjustmentTransaction {
  startValue: number;
  delta: number;
  startedAt: number;
  lastInputAt: number;
}

export function beginNumericAdjustment(
  startValue: number,
  delta: number,
  timestamp: number,
): NumericAdjustmentTransaction {
  return {
    startValue,
    delta,
    startedAt: timestamp,
    lastInputAt: timestamp,
  };
}

export function appendNumericAdjustment(
  current: NumericAdjustmentTransaction | null,
  startValue: number,
  delta: number,
  timestamp: number,
): NumericAdjustmentTransaction {
  if (!current) return beginNumericAdjustment(startValue, delta, timestamp);
  return {
    ...current,
    delta: current.delta + delta,
    lastInputAt: timestamp,
  };
}

export function numericAdjustmentValue(
  transaction: NumericAdjustmentTransaction,
): number {
  return transaction.startValue + transaction.delta;
}
