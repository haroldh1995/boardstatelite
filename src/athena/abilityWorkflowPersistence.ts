import type { AbilityWorkflow, AbilityChoice } from "./abilityWorkflowTypes";

export function normalizeAbilityWorkflow(
  value: unknown,
): AbilityWorkflow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<AbilityWorkflow>;
  const ability = input.ability;
  if (
    input.version !== 1 ||
    !ability ||
    typeof ability.id !== "string" ||
    typeof ability.text !== "string" ||
    typeof ability.cost !== "string" ||
    typeof ability.effect !== "string" ||
    !["activated", "triggered"].includes(ability.kind) ||
    typeof input.sourceId !== "string" ||
    typeof input.sourceLabel !== "string" ||
    !["selection", "resolution", "resolved", "cancelled", "manual"].includes(
      input.stage ?? "",
    )
  )
    return undefined;
  const choices: Record<string, AbilityChoice> = {};
  for (const [key, candidate] of Object.entries(input.choices ?? {}).slice(
    0,
    80,
  )) {
    if (
      !/^(selection|resolution|targets)(?:\.(?:mode)?\d+)+$/.test(key) ||
      !candidate ||
      typeof candidate !== "object"
    )
      continue;
    choices[key] = {
      accepted:
        typeof candidate.accepted === "boolean"
          ? candidate.accepted
          : undefined,
      ids: Array.isArray(candidate.ids)
        ? candidate.ids.filter((id) => typeof id === "string").slice(0, 50)
        : undefined,
      external:
        typeof candidate.external === "string"
          ? candidate.external.slice(0, 120)
          : undefined,
      counterType:
        typeof candidate.counterType === "string"
          ? candidate.counterType.slice(0, 60)
          : undefined,
      modes: Array.isArray(candidate.modes)
        ? candidate.modes
            .filter(
              (mode) => Number.isSafeInteger(mode) && mode >= 0 && mode < 20,
            )
            .slice(0, 20)
        : undefined,
      distribution: Object.fromEntries(
        Object.entries(candidate.distribution ?? {})
          .filter(
            ([, amount]) =>
              Number.isSafeInteger(amount) && amount >= 0 && amount <= 999999,
          )
          .slice(0, 50),
      ),
    };
  }
  return {
    version: 1,
    sourceId: input.sourceId,
    sourceLabel: input.sourceLabel,
    ability: {
      id: ability.id,
      kind: ability.kind,
      text: ability.text.slice(0, 10000),
      cost: ability.cost.slice(0, 2000),
      effect: ability.effect.slice(0, 10000),
      limit: ["turn", "own-turn", "game"].includes(ability.limit ?? "")
        ? ability.limit
        : null,
      loyalty: ability.loyalty === true,
      collective: ability.collective === true,
      timing: ["sorcery", "your-turn", "opponent-turn"].includes(
        ability.timing ?? "",
      )
        ? ability.timing
        : null,
    },
    stage: input.stage!,
    choices,
    costsCommitted: input.costsCommitted === true,
    committedEventIds: Array.isArray(input.committedEventIds)
      ? input.committedEventIds
          .filter((id) => typeof id === "string")
          .slice(-500)
      : [],
  };
}
