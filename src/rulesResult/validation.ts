import { createObjectResolver } from "./objectResolver";
import {
  RULES_RESULT_SCHEMA_VERSION,
  type CanonicalRulesResult,
  type RulesObjectReference,
  type RulesResultValidation,
} from "./types";
import type { FieldState } from "../domain/types";

const VALID_SOURCES = new Set(["lite-helper", "boardstate-authority"]);
const SAFE_ID = /^[A-Za-z0-9:_./' +#-]+$/;

export function validateRulesResult(
  field: FieldState,
  result: CanonicalRulesResult,
): RulesResultValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const resolver = createObjectResolver(field);

  if (result.schemaVersion !== RULES_RESULT_SCHEMA_VERSION) {
    errors.push("Unknown rules-result schema version.");
  }
  if (!VALID_SOURCES.has(result.source)) {
    errors.push("Unknown rules-result source.");
  }
  if (result.fieldId !== field.id) {
    errors.push("Rules result does not match the active field.");
  }
  if (result.sessionId !== field.session.id) {
    errors.push("Rules result does not match the active session.");
  }
  if (
    result.source === "boardstate-authority" &&
    !result.authority.rulesVersion
  ) {
    errors.push("Authoritative rules result is missing a rules version.");
  }

  for (const identifier of [
    result.id,
    result.fieldId,
    result.sessionId,
    result.authority.rulesVersion ?? "",
  ]) {
    if (identifier && !isSafeIdentifier(identifier)) {
      errors.push("Rules result contains a malformed identifier.");
      break;
    }
  }

  for (const change of result.changes) {
    if ("amount" in change && !isValidAmount(change.amount)) {
      errors.push("Rules result contains an invalid numeric amount.");
    }
    if (change.kind === "life" && change.player !== "you") {
      warnings.push(
        "Opponent life changes are summarized but not numerically tracked in Lite.",
      );
    }
    if (change.kind === "token" && change.mode === "created") continue;
    if (change.kind === "permanent" && change.mode === "created") continue;
    for (const reference of referencesForChange(change)) {
      if (!resolver.resolve(reference)) {
        errors.push("Rules result references an unknown battlefield object.");
      }
    }
  }

  for (const event of result.events) {
    if (event.sourceId && !isSafeIdentifier(event.sourceId)) {
      errors.push("Rules result contains a malformed event source.");
      break;
    }
    if (event.controller !== "you" && event.owner !== "you") {
      warnings.push(
        "Remote participant events are preserved for details but not synchronized in Lite.",
      );
    }
  }

  return {
    status: errors.length > 0 ? "invalid" : "valid",
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

function referencesForChange(
  change: CanonicalRulesResult["changes"][number],
): RulesObjectReference[] {
  switch (change.kind) {
    case "counter":
    case "zone":
    case "status":
    case "transform":
    case "depower":
    case "tracking":
    case "power-toughness":
      return [change.target];
    case "token":
    case "permanent":
      return change.target ? [change.target] : [];
    case "attachment":
      return change.host
        ? [change.attachment, change.host]
        : [change.attachment];
    default:
      return [];
  }
}

function isValidAmount(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= 999_999_999;
}

function isSafeIdentifier(value: string): boolean {
  return value.length <= 180 && SAFE_ID.test(value);
}
