import { makeId } from "./cards";

export const RANDOMIZER_STATE_VERSION = 1;

export interface RandomNumberSource {
  integer(minimum: number, maximum: number): number;
}

export type RandomizerResult =
  | {
      id: string;
      kind: "dice";
      count: number;
      sides: number;
      values: number[];
      total: number;
      source: "manual" | "effect-requested";
      public: boolean;
      generatedAt: string;
    }
  | {
      id: string;
      kind: "coin";
      count: number;
      values: Array<"Heads" | "Tails">;
      total: number;
      source: "manual" | "effect-requested";
      public: boolean;
      generatedAt: string;
    };

export interface RandomizerState {
  version: typeof RANDOMIZER_STATE_VERSION;
  history: RandomizerResult[];
  latest: RandomizerResult | null;
}

export function createDefaultRandomizerState(): RandomizerState {
  return { version: RANDOMIZER_STATE_VERSION, history: [], latest: null };
}

export function normalizeRandomizerState(value: unknown): RandomizerState {
  if (!value || typeof value !== "object")
    return createDefaultRandomizerState();
  const candidate = value as Partial<RandomizerState>;
  const history = Array.isArray(candidate.history)
    ? candidate.history.slice(-20)
    : [];
  return {
    version: RANDOMIZER_STATE_VERSION,
    history,
    latest: candidate.latest ?? history.at(-1) ?? null,
  };
}

export function rollDice(
  count: number,
  sides: number,
  random: RandomNumberSource,
  options: {
    source?: RandomizerResult["source"];
    public?: boolean;
    timestamp?: string;
  } = {},
): RandomizerResult & { kind: "dice" } {
  const boundedCount = Math.min(40, Math.max(1, Math.trunc(count)));
  const boundedSides = Math.min(1000000, Math.max(2, Math.trunc(sides)));
  const values = Array.from({ length: boundedCount }, () =>
    random.integer(1, boundedSides),
  );
  return {
    id: makeId("dice-result"),
    kind: "dice",
    count: boundedCount,
    sides: boundedSides,
    values,
    total: values.reduce((sum, value) => sum + value, 0),
    source: options.source ?? "manual",
    public: options.public ?? true,
    generatedAt: options.timestamp ?? new Date().toISOString(),
  };
}

export function flipCoins(
  count: number,
  random: RandomNumberSource,
  options: {
    source?: RandomizerResult["source"];
    public?: boolean;
    timestamp?: string;
  } = {},
): RandomizerResult & { kind: "coin" } {
  const boundedCount = Math.min(100, Math.max(1, Math.trunc(count)));
  const values = Array.from({ length: boundedCount }, () =>
    random.integer(0, 1) === 0 ? ("Heads" as const) : ("Tails" as const),
  );
  return {
    id: makeId("coin-result"),
    kind: "coin",
    count: boundedCount,
    values,
    total: values.filter((value) => value === "Heads").length,
    source: options.source ?? "manual",
    public: options.public ?? true,
    generatedAt: options.timestamp ?? new Date().toISOString(),
  };
}

export function recordRandomizerResult(
  state: RandomizerState,
  result: RandomizerResult,
): RandomizerState {
  return {
    ...state,
    latest: result,
    history: [
      ...state.history.filter((entry) => entry.id !== result.id),
      result,
    ].slice(-20),
  };
}
