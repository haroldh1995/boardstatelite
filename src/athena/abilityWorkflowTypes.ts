import type { AbilityMetadata } from "../domain/abilityMetadata";
import type { AthenaTargetConstraints } from "./decisionEngineTypes";
import type { AthenaForecastInputDraft } from "./eventForecastTypes";

export interface AbilitySelector {
  constraints: Partial<AthenaTargetConstraints>;
  source: boolean;
  all: boolean;
  targeting: boolean;
  minimum: number;
  maximum: number;
}
export type AbilityInstruction =
  | {
      kind: "event";
      text: string;
      draft: Partial<AthenaForecastInputDraft>;
      selector?: AbilitySelector;
      distribution?: number;
      quantitySourceCounters?: string;
    }
  | { kind: "optional"; text: string; instructions: AbilityInstruction[] }
  | {
      kind: "modes";
      text: string;
      count: number;
      modes: { text: string; instructions: AbilityInstruction[] }[];
    }
  | { kind: "manual" | "payment"; text: string };

export interface AbilityChoice {
  accepted?: boolean;
  ids?: string[];
  distribution?: Record<string, number>;
  counterType?: string;
  modes?: number[];
  external?: string;
}
/** Embedded in the existing Turn Memory item, not a second pending queue. */
export interface AbilityWorkflow {
  version: 1;
  sourceId: string;
  sourceLabel: string;
  ability: AbilityMetadata;
  stage: "selection" | "resolution" | "resolved" | "cancelled" | "manual";
  choices: Record<string, AbilityChoice>;
  costsCommitted: boolean;
  committedEventIds: string[];
}
