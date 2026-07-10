import type { BoardStateRulesEvaluation, RulesChangeRecord } from "./types";

export function parseRulesEvaluationResult(
  value: unknown,
): BoardStateRulesEvaluation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BoardStateRulesEvaluation>;
  if (
    candidate.source !== "boardstate-authority" ||
    typeof candidate.ok !== "boolean" ||
    typeof candidate.rulesVersion !== "string"
  ) {
    return null;
  }

  return {
    ok: candidate.ok,
    source: "boardstate-authority",
    rulesVersion: candidate.rulesVersion,
    triggerList: arrayOrEmpty(candidate.triggerList),
    replacementEffects: arrayOrEmpty(candidate.replacementEffects),
    staticRecalculations: arrayOrEmpty(candidate.staticRecalculations),
    battlefieldChanges: rulesChanges(candidate.battlefieldChanges),
    lifeChanges: rulesChanges(candidate.lifeChanges),
    counterChanges: rulesChanges(candidate.counterChanges),
    tokenChanges: rulesChanges(candidate.tokenChanges),
    attachments: rulesChanges(candidate.attachments),
    zoneChanges: rulesChanges(candidate.zoneChanges),
    messages: stringArray(candidate.messages),
    warnings: stringArray(candidate.warnings),
    unsupportedInteractions: stringArray(candidate.unsupportedInteractions),
    events: arrayOrEmpty(candidate.events),
  };
}

function arrayOrEmpty<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function rulesChanges(value: unknown): RulesChangeRecord[] {
  return Array.isArray(value) ? (value as RulesChangeRecord[]) : [];
}
