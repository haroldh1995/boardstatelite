import type { FieldState, PermanentGroup } from "./types";

export interface AbilityMetadata {
  collective?: boolean;
  id: string;
  kind: "activated" | "triggered";
  text: string;
  cost: string;
  effect: string;
  limit: "turn" | "own-turn" | "game" | null;
  loyalty: boolean;
  timing: "sorcery" | "your-turn" | "opponent-turn" | null;
}
export interface AbilityUse {
  sourceId: string;
  abilityId: string;
  turnId: string;
  actionId: string;
  loyalty: boolean;
}

// Cache syntax, never availability. Oracle changes naturally select a new cache key.
const cache = new Map<string, AbilityMetadata[]>();
export function cardAbilities(
  group: PermanentGroup,
  field?: FieldState,
): AbilityMetadata[] {
  if (
    !group.identity ||
    group.zone !== "battlefield" ||
    group.statuses.faceDown ||
    group.trackingEnabled === false ||
    group.depowerMode === "all"
  )
    return [];
  const text = group.identity.oracleText;
  let parsed = cache.get(text);
  if (!parsed) {
    const paragraphs = text.split(/\r?\n/).reduce<string[]>((lines, line) => {
      if (/^\s*•/.test(line) && lines.length)
        lines[lines.length - 1] += ` ${line.trim()}`;
      else lines.push(line);
      return lines;
    }, []);
    parsed = paragraphs.flatMap((line, index) => {
      const trimmed = line.trim();
      const abilityBody = trimmed.replace(
        /^.*?[—–-]\s*(?=(?:When|Whenever|At the beginning|At the end)\b)/i,
        "",
      );
      const triggered =
        /^(?:When|Whenever|At the beginning|At the end)\b/i.test(abilityBody);
      const colon = trimmed.indexOf(":");
      const cost = colon >= 0 ? trimmed.slice(0, colon).trim() : "";
      // Anchored cost grammar excludes quoted granted abilities, flavor and trigger text.
      const activated =
        !triggered &&
        /^(?:\{[^}]+\}|[+\-−]?\d+|Sacrifice\b|Discard\b|Pay\b|Remove\b|Tap\b|Untap\b)/i.test(
          cost,
        );
      if (!triggered && !activated) return [];
      const comma = abilityBody.indexOf(",");
      const effect = triggered
        ? comma < 0
          ? abilityBody
          : abilityBody.slice(comma + 1).trim()
        : trimmed.slice(colon + 1).trim();
      const loyalty = activated && /^[+\-−]?\d+$/.test(cost);
      return [
        {
          collective: /Activate only one of these abilities each turn/i.test(
            text,
          ),
          id: `ability:${index}:${trimmed}`,
          kind: triggered ? ("triggered" as const) : ("activated" as const),
          text: trimmed,
          cost: triggered ? "" : cost,
          effect,
          loyalty,
          limit: /activate only once (?:each|per) game/i.test(effect)
            ? ("game" as const)
            : /activate only once during your turn/i.test(effect)
              ? ("own-turn" as const)
              : /activate only once (?:each|per) turn/i.test(effect) || loyalty
                ? ("turn" as const)
                : null,
          timing:
            /activate only as a sorcery/i.test(effect) || loyalty
              ? ("sorcery" as const)
              : /activate only (?:once )?during your turn/i.test(effect)
                ? ("your-turn" as const)
                : /activate only during an opponent's turn/i.test(effect)
                  ? ("opponent-turn" as const)
                  : null,
        },
      ];
    });
    if (cache.size >= 300) cache.delete(cache.keys().next().value!);
    cache.set(text, parsed);
  }
  const native = parsed.filter(
    (ability, index) =>
      !(group.depowerMode === "triggered" && ability.kind === "triggered") &&
      (group.abilitiesActive || group.depowerMode === "triggered") &&
      !group.disabledAbilities.some((id) =>
        [ability.id, ability.text, String(index), `ability:${index}`].includes(
          id,
        ),
      ),
  );
  if (!field) return native;
  const granted = field.groups.flatMap((source) => {
    if (
      source.zone !== "battlefield" ||
      source.trackingEnabled === false ||
      source.depowerMode === "all" ||
      !source.abilitiesActive ||
      source.statuses.faceDown
    )
      return [];
    return (source.identity?.oracleText ?? "")
      .split(/\r?\n/)
      .flatMap((line, index) => {
        const match = line.match(
          /^(Creatures you control|Artifacts you control|Lands you control|Enchanted creature|Equipped creature) (?:have|has) ["“](.+)["”]\.?$/,
        );
        if (
          !match ||
          source.disabledAbilities.includes(line) ||
          source.disabledAbilities.includes(`ability:${index}`)
        )
          return [];
        const recipient = /^(Enchanted|Equipped)/.test(match[1])
          ? source.attachedTo === group.id
          : group.controller === source.controller &&
            group.characteristics.cardTypes.includes(
              match[1].split(" ")[0].replace(/s$/, ""),
            );
        if (!recipient) return [];
        return cardAbilities({
          ...group,
          identity: { ...group.identity!, oracleText: match[2] },
          disabledAbilities: [],
        })
          .filter((ability) => ability.kind === "activated")
          .map((ability) => ({
            ...ability,
            id: `granted:${source.id}:${index}:${ability.id}`,
          }));
      });
  });
  return [...native, ...granted];
}

export function abilityAvailability(
  field: FieldState,
  group: PermanentGroup,
  ability: AbilityMetadata,
) {
  const reasons: string[] = [];
  const uses = field.turnContext.abilityUses ?? [];
  const used = uses.some(
    (use) =>
      use.sourceId === group.id &&
      (use.abilityId === ability.id ||
        ability.collective ||
        (ability.loyalty && use.loyalty)) &&
      (ability.limit === "game" || use.turnId === field.turnContext.turnId),
  );
  if ((ability.limit || ability.collective) && used)
    reasons.push(
      ability.limit === "game" ? "Recorded this game" : "Recorded this turn",
    );
  if (/\{T\}/i.test(ability.cost) && group.statuses.tapped)
    reasons.push("Currently tapped");
  if (/\{Q\}/i.test(ability.cost) && !group.statuses.tapped)
    reasons.push("Currently untapped");
  const counterCost = ability.cost.match(
    /^Remove (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (?:(\+1\/\+1|-1\/-1|[A-Za-z]+) )?counters? from (?:this creature|this permanent|this artifact)$/i,
  );
  if (counterCost) {
    const words: Record<string, number> = {
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
    const required =
      words[counterCost[1].toLowerCase()] ?? Number(counterCost[1]);
    const counter = counterCost[2] ?? "";
    if (!counter || (group.counters[counter] ?? 0) < required)
      reasons.push(
        `Tracked ${counter || "required"} counters are insufficient`,
      );
  }
  if (
    ability.loyalty &&
    Number(ability.cost.replace("−", "-")) < -(group.counters.Loyalty ?? 0)
  )
    reasons.push("Tracked loyalty is insufficient");
  const advisories: string[] = [];
  if (ability.timing === "sorcery")
    advisories.push("Activate only as a sorcery - verify timing.");
  if (ability.timing === "your-turn" && field.turnContext.status !== "active")
    advisories.push("Activate only during your turn - verify timing.");
  if (ability.timing === "opponent-turn")
    advisories.push("Activate only during an opponent's turn - verify timing.");
  if (group.statuses.summoningSick && /\{[TQ]\}/i.test(ability.cost))
    advisories.push("Possible summoning restriction");
  if (field.turnContext.status === "between-turns" && ability.limit === "turn")
    advisories.push(
      "Opponent turn boundaries are not inferred. Correct usage if needed.",
    );
  return { available: reasons.length === 0, reasons, advisories };
}
