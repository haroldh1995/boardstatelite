import type { RelevantTotalKey } from "../domain/types";

export const REFERENCE_TOTAL_KEYS: RelevantTotalKey[] = [
  "lands",
  "nonbasicLands",
  "artifacts",
  "cardsInHand",
  "cardsInExile",
];

export function isReferenceFixtureMode(): boolean {
  if (typeof window === "undefined") return false;
  const requested =
    new URLSearchParams(window.location.search).get("fixture") === "reference";
  if (!requested) return false;
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
  return import.meta.env.DEV || localHostnames.has(window.location.hostname);
}

const REFERENCE_TOTALS: Partial<Record<RelevantTotalKey, number>> = {
  lands: 8,
  nonbasicLands: 3,
  artifacts: 7,
  cardsInHand: 5,
  cardsInExile: 2,
};

const REFERENCE_SECTION_COUNTS: Record<string, number> = {
  creatures: 11,
  other: 7,
};

export function referenceTotalValue(
  key: RelevantTotalKey,
  actual: number,
): number {
  return isReferenceFixtureMode() ? (REFERENCE_TOTALS[key] ?? actual) : actual;
}

export function referenceSectionCount(id: string, actual: number): number {
  return isReferenceFixtureMode()
    ? (REFERENCE_SECTION_COUNTS[id] ?? actual)
    : actual;
}
