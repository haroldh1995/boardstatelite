import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendNumericAdjustment,
  type NumericAdjustmentTransaction,
} from "../domain/numericAdjustment";

const DEFAULT_INACTIVITY_MS = 650;
const DEFAULT_RETAIN_MS = 900;

export function useGroupedNumericAdjustment({
  value,
  minimum = Number.NEGATIVE_INFINITY,
  maximum = Number.POSITIVE_INFINITY,
  onCommit,
  inactivityMs = DEFAULT_INACTIVITY_MS,
  retainMs = DEFAULT_RETAIN_MS,
}: {
  value: number;
  minimum?: number;
  maximum?: number;
  onCommit: (delta: number) => void;
  inactivityMs?: number;
  retainMs?: number;
}) {
  const [transaction, setTransaction] =
    useState<NumericAdjustmentTransaction | null>(null);
  const [retainedDelta, setRetainedDelta] = useState(0);
  const transactionRef = useRef<NumericAdjustmentTransaction | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const retainTimerRef = useRef<number | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);

  const clearRetainTimer = useCallback(() => {
    if (retainTimerRef.current !== null) {
      window.clearTimeout(retainTimerRef.current);
      retainTimerRef.current = null;
    }
  }, []);

  const finish = useCallback(() => {
    clearCommitTimer();
    const current = transactionRef.current;
    if (!current) return;
    transactionRef.current = null;
    setTransaction(null);
    if (current.delta === 0) {
      setRetainedDelta(0);
      return;
    }
    commitRef.current(current.delta);
    setRetainedDelta(current.delta);
    clearRetainTimer();
    retainTimerRef.current = window.setTimeout(() => {
      setRetainedDelta(0);
      retainTimerRef.current = null;
    }, retainMs);
  }, [clearCommitTimer, clearRetainTimer, retainMs]);

  const adjust = useCallback(
    (delta: number) => {
      const current = transactionRef.current;
      const startValue = current?.startValue ?? value;
      const boundedCurrent = Math.min(
        maximum,
        Math.max(minimum, startValue + (current?.delta ?? 0)),
      );
      const boundedNext = Math.min(
        maximum,
        Math.max(minimum, boundedCurrent + delta),
      );
      const effectiveDelta = boundedNext - boundedCurrent;
      if (effectiveDelta === 0) return;
      const next = appendNumericAdjustment(
        current,
        startValue,
        effectiveDelta,
        Date.now(),
      );
      transactionRef.current = next;
      setTransaction(next);
      setRetainedDelta(0);
      clearRetainTimer();
      clearCommitTimer();
      commitTimerRef.current = window.setTimeout(finish, inactivityMs);
    },
    [
      clearCommitTimer,
      clearRetainTimer,
      finish,
      inactivityMs,
      maximum,
      minimum,
      value,
    ],
  );

  useEffect(
    () => () => {
      clearCommitTimer();
      clearRetainTimer();
      const current = transactionRef.current;
      if (current?.delta) commitRef.current(current.delta);
    },
    [clearCommitTimer, clearRetainTimer],
  );

  return {
    adjust,
    finish,
    displayedValue: transaction
      ? Math.min(
          maximum,
          Math.max(minimum, transaction.startValue + transaction.delta),
        )
      : value,
    displayedDelta: transaction?.delta ?? retainedDelta,
    active: transaction !== null,
  };
}
