import { classifySupportedEffectOutcomes } from "../domain/effectOutcomes";
import type {
  AbilityInstruction,
  AbilitySelector,
} from "./abilityWorkflowTypes";

const numbers: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const count = (text: string) =>
  numbers[text.toLowerCase()] ?? (/^\d+$/.test(text) ? Number(text) : NaN);

export function abilitySelector(text: string): AbilitySelector | null {
  const normalized = text.toLowerCase().replace(/[.]/g, "").trim();
  if (/^(?:this (?:creature|artifact|permanent)|source)$/.test(normalized))
    return {
      constraints: {},
      source: true,
      all: false,
      targeting: false,
      minimum: 1,
      maximum: 1,
    };
  const match = normalized.match(
    /^(?:(each|all|target|another|a|an|up to (\w+) target|one, two, or three target) )?(other )?(?:(nontoken|token|legendary|tapped|untapped) )?(creatures?|artifacts?|enchantments?|lands?|permanents?|creature or enchantment|artifact or creature)(?: (you control|an opponent controls))?$/,
  );
  if (!match) return null;
  // Extra predicates are checked by the shared selector adapter after base candidates.
  const types =
    match[5] === "permanent" || match[5] === "permanents"
      ? []
      : match[5]
          .split(" or ")
          .map((part) => part.replace(/s$/, ""))
          .map((part) => part[0].toUpperCase() + part.slice(1));
  const max = match[2]
    ? count(match[2])
    : match[1] === "one, two, or three target"
      ? 3
      : 1;
  return {
    source: false,
    all: match[1] === "each" || match[1] === "all",
    targeting: Boolean(match[1]?.includes("target")),
    minimum: match[2] ? 0 : 1,
    maximum: max,
    constraints: {
      controller:
        match[6] === "you control" ||
        ["a", "an", "another", "all"].includes(match[1])
          ? "you"
          : match[6]
            ? "opponent"
            : "any",
      cardTypes: types,
      sourceExcluded: Boolean(match[3]) || match[1] === "another",
      tokenStatus:
        match[4] === "token"
          ? "token"
          : match[4] === "nontoken"
            ? "nontoken"
            : "any",
      zones: ["battlefield"],
      allowOpponentPlaceholder: false,
    },
  };
}

/** A bounded full-clause grammar. Unconsumed conditions never become automatic effects. */
export function compileAbilityInstructions(text: string): AbilityInstruction[] {
  text = text.replace(/\s*Activate only[^.]*\.?/gi, "").trim();
  if (!text) return [];
  const modal = text.match(/^Choose (one|two|three)\s*[—-]\s*([\s\S]+)$/i);
  if (modal)
    return [
      {
        kind: "modes",
        text,
        count: count(modal[1]),
        modes: modal[2]
          .split(/\s*•\s*/)
          .filter(Boolean)
          .map((mode) => ({
            text: mode,
            instructions: compileAbilityInstructions(mode),
          })),
      },
    ];
  const optional = text.match(/^You may (.+?)(?:\. If you do, (.+))?\.?$/i);
  if (optional)
    return [
      {
        kind: "optional",
        text,
        instructions: compileAbilityInstructions(
          optional[1].replace(/\.$/, "") +
            (optional[2] ? `. ${optional[2]}` : ""),
        ),
      },
    ];
  if (/\b(if|unless|when you do|for each|that many|equal to)\b/i.test(text))
    return [{ kind: "manual", text }];
  return text
    .replace(/\band (?:you )?(gain|lose)\b/gi, ". You $1")
    .split(/\.\s*|;\s*/)
    .map((part) => part.trim().replace(/^then /i, ""))
    .filter(Boolean)
    .flatMap((part): AbilityInstruction[] => {
      const counters = part.match(
        /^(Put|Remove|Distribute) (\w+|\d+) (?:(\+1\/\+1|-1\/-1|[A-Za-z]+) )?counters? (?:on|from|among) (.+)$/i,
      );
      if (counters) {
        const selector = abilitySelector(counters[4]);
        const quantity = count(counters[2]);
        if (selector && Number.isSafeInteger(quantity))
          return [
            {
              kind: "event",
              text: part,
              selector,
              distribution:
                counters[1].toLowerCase() === "distribute"
                  ? quantity
                  : undefined,
              draft: {
                eventCategory:
                  counters[1].toLowerCase() === "remove"
                    ? "counter-removed"
                    : "counter-placed",
                quantity,
                counterType: counters[3] ?? null,
              },
            },
          ];
      }
      const move = part.match(/^(Sacrifice|Destroy|Exile|Tap|Untap) (.+)$/i);
      if (move) {
        const selector = abilitySelector(move[2]);
        if (selector)
          return [
            {
              kind: "event",
              text: part,
              selector,
              draft: {
                eventCategory: (
                  {
                    sacrifice: "permanent-sacrificed",
                    destroy: "permanent-died",
                    exile: "permanent-exiled",
                    tap: "permanent-tapped",
                    untap: "permanent-untapped",
                  } as const
                )[move[1].toLowerCase() as "sacrifice"],
                quantity: 1,
                zoneOrigin: "battlefield",
                zoneDestination: /^(sacrifice|destroy)$/i.test(move[1])
                  ? "graveyard"
                  : /^exile$/i.test(move[1])
                    ? "exile"
                    : "battlefield",
              },
            },
          ];
      }
      const draw = part.match(/^(?:You )?draw (\w+|\d+) cards?$/i);
      if (draw && Number.isSafeInteger(count(draw[1])))
        return [
          {
            kind: "event",
            text: part,
            draft: { eventCategory: "cards-drawn", quantity: count(draw[1]) },
          },
        ];
      const classified = classifySupportedEffectOutcomes(
        /^(gain|lose|pay) /i.test(part) ? `You ${part}` : part,
      );
      if (classified.status === "supported")
        return classified.outcomes.map((outcome) => ({
          kind: "event",
          text: part,
          draft:
            outcome.kind === "life"
              ? {
                  eventCategory:
                    outcome.mode === "gain" ? "life-gained" : "life-lost",
                  quantity: outcome.amount,
                }
              : {
                  eventCategory: "token-created",
                  quantity: outcome.quantity,
                  tokenDefinition: {
                    id: `ability-token:${outcome.name}`,
                    name: outcome.name,
                    power: outcome.power,
                    toughness: outcome.toughness,
                    characteristics: {
                      cardTypes: outcome.cardTypes,
                      subtypes: outcome.subtypes,
                      colors: outcome.colors,
                      supertypes: [],
                      manaValue: 0,
                      isToken: true,
                      isCreature: outcome.cardTypes.includes("Creature"),
                      isLegendary: false,
                      knownFields: [
                        "cardTypes",
                        "subtypes",
                        "colors",
                        "isToken",
                        "isCreature",
                      ],
                    },
                  },
                  metadata: {
                    tapped: outcome.tapped,
                    attacking: outcome.attacking,
                  },
                },
        }));
      return [{ kind: "manual", text: part }];
    });
}

export function compileAbilityCosts(cost: string): AbilityInstruction[] {
  if (!cost) return [];
  if (/^[+\-−]?\d+$/.test(cost)) {
    const amount = Number(cost.replace("−", "-"));
    return amount === 0
      ? []
      : [
          {
            kind: "event",
            text: `${cost} Loyalty`,
            selector: abilitySelector("source")!,
            draft: {
              eventCategory: amount > 0 ? "counter-placed" : "counter-removed",
              counterType: "Loyalty",
              quantity: Math.abs(amount),
            },
          },
        ];
  }
  return cost.split(/,\s*/).flatMap((part): AbilityInstruction[] => {
    if (part === "{T}" || part === "{Q}")
      return [
        {
          kind: "event",
          text: part,
          selector: abilitySelector("source")!,
          draft: {
            eventCategory:
              part === "{T}" ? "permanent-tapped" : "permanent-untapped",
            quantity: 1,
          },
        },
      ];
    if (/^(?:\{[^}]+\})+$/.test(part))
      return [{ kind: "payment", text: `Pay ${part} at the table` }];
    if (/^Discard (?:a|one) card$/i.test(part))
      return [
        {
          kind: "event",
          text: part,
          selector: {
            source: false,
            all: false,
            targeting: false,
            minimum: 1,
            maximum: 1,
            constraints: { controller: "you", zones: ["hand"] },
          },
          draft: {
            eventCategory: "cards-discarded",
            quantity: 1,
            zoneOrigin: "hand",
            zoneDestination: "graveyard",
          },
        },
      ];
    return compileAbilityInstructions(part);
  });
}
