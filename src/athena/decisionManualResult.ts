import type { FieldState } from "../domain/types";
import {
  createAthenaForecastInput,
  createForecastEnvironment,
} from "./eventForecast";
import type { AthenaForecastInput } from "./eventForecastTypes";
import { ATHENA_EVENT_CATEGORIES } from "./dependencyGraphTypes";
import type { AthenaDecisionRequest } from "./decisionEngineTypes";

export function createAthenaManualResultForecast(
  field: FieldState,
  request: AthenaDecisionRequest,
  timestamp = field.updatedAt,
): AthenaForecastInput | null {
  const manual = request.answer?.manualResult;
  if (!manual) return null;
  const category =
    manual.eventCategory as (typeof ATHENA_EVENT_CATEGORIES)[number];
  if (!ATHENA_EVENT_CATEGORIES.includes(category)) return null;
  return createAthenaForecastInput(
    {
      eventId: `athena-manual-result:${normalizeLabel(request.id)}`,
      eventCategory: category,
      eventSource: "lite-helper",
      authoritySource: "confirmed-user-report",
      timestamp,
      sourceObjectId: request.sourceObjectId,
      subjectGroupIds: [...manual.targetGroupIds],
      quantity: manual.quantity,
      counterType: manual.counterType ?? undefined,
      zoneOrigin: manual.originZone,
      zoneDestination: manual.destinationZone,
      tokenDefinition:
        category === "token-created" &&
        manual.tokenName &&
        manual.tokenPower !== null &&
        manual.tokenToughness !== null
          ? {
              id: `manual-token:${normalizeLabel(manual.tokenName)}:${manual.tokenPower}/${manual.tokenToughness}`,
              name: manual.tokenName,
              power: manual.tokenPower,
              toughness: manual.tokenToughness,
              characteristics: {
                cardTypes: uniqueStrings([
                  ...manual.tokenCardTypes,
                  "Creature",
                ]),
                supertypes: [],
                subtypes: [...manual.tokenSubtypes],
                colors: [...manual.tokenColors],
                manaValue: 0,
                isToken: true,
                isCreature: true,
                isLegendary: false,
                knownFields: [
                  "cardTypes",
                  "supertypes",
                  "subtypes",
                  "colors",
                  "manaValue",
                  "isToken",
                  "isCreature",
                  "isLegendary",
                ],
              },
            }
          : null,
      metadata: {
        confirmed: true,
        manualResult: true,
        decisionId: request.id,
        tokenName: manual.tokenName,
        tapped: manual.tokenTapped,
        attacking: manual.tokenAttacking,
      },
    },
    createForecastEnvironment(field),
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
