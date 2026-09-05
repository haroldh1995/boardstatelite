export interface SupportedLifeOutcome {
  kind: "life";
  mode: "gain" | "lose" | "pay";
  amount: number;
}

export interface SupportedTokenOutcome {
  kind: "token";
  quantity: number;
  name: string;
  power: number;
  toughness: number;
  cardTypes: string[];
  subtypes: string[];
  colors: string[];
  tapped: boolean;
  attacking: boolean;
}

export type SupportedEffectOutcome =
  | SupportedLifeOutcome
  | SupportedTokenOutcome;

export interface SupportedEffectClassification {
  status: "supported" | "manual-required";
  outcomes: SupportedEffectOutcome[];
  unsupportedClauses: string[];
}

const NUMBER_WORDS: Record<string, number> = {
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

const COLOR_WORDS: Record<string, string> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};

const NAMED_NONCREATURE_TOKENS: Record<
  string,
  { name: string; cardTypes: string[]; subtypes: string[] }
> = {
  treasure: {
    name: "Treasure",
    cardTypes: ["Artifact"],
    subtypes: ["Treasure"],
  },
  food: { name: "Food", cardTypes: ["Artifact"], subtypes: ["Food"] },
  clue: { name: "Clue", cardTypes: ["Artifact"], subtypes: ["Clue"] },
  blood: { name: "Blood", cardTypes: ["Artifact"], subtypes: ["Blood"] },
  map: { name: "Map", cardTypes: ["Artifact"], subtypes: ["Map"] },
  powerstone: {
    name: "Powerstone",
    cardTypes: ["Artifact"],
    subtypes: ["Powerstone"],
  },
};

export function classifySupportedEffectOutcomes(
  oracleOrEffectText: string,
): SupportedEffectClassification {
  const extracted = effectClause(oracleOrEffectText);
  const effectText = extracted.effect;
  if (!effectText) {
    return { status: "manual-required", outcomes: [], unsupportedClauses: [] };
  }
  const clauses = splitInstructions(effectText);
  const outcomes: SupportedEffectOutcome[] = [];
  const unsupportedClauses: string[] = [];
  for (const clause of clauses) {
    const parsed = parseLifeOutcome(clause) ?? parseTokenOutcome(clause);
    if (parsed) outcomes.push(parsed);
    else unsupportedClauses.push(clause);
  }
  return {
    status:
      extracted.conditionSupported &&
      outcomes.length > 0 &&
      unsupportedClauses.length === 0
        ? "supported"
        : "manual-required",
    outcomes,
    unsupportedClauses: extracted.conditionSupported
      ? unsupportedClauses
      : [extracted.condition, ...unsupportedClauses].filter(Boolean),
  };
}

function effectClause(value: string): {
  effect: string;
  condition: string;
  conditionSupported: boolean;
} {
  const line = value
    .replace(/[’]/g, "'")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!line) return { effect: "", condition: "", conditionSupported: false };
  if (/^(when|whenever|at)\b/i.test(line)) {
    const comma = line.indexOf(",");
    const condition = comma >= 0 ? line.slice(0, comma).trim() : line;
    return {
      effect: comma >= 0 ? line.slice(comma + 1).trim() : "",
      condition,
      conditionSupported: supportedTriggerCondition(condition),
    };
  }
  return { effect: line, condition: "", conditionSupported: true };
}

function supportedTriggerCondition(condition: string): boolean {
  const normalized = condition.toLowerCase();
  if (
    /\b(opponent|you don't control|an opponent controls)\b/.test(normalized)
  ) {
    return false;
  }
  return [
    /^(when|whenever) (a |an |another |one or more )?(creature|token|artifact|land|permanent)s?( you control)? enters?\b/,
    /^(when|whenever) you cast\b/,
    /^(when|whenever) you (gain|lose) life\b/,
    /^(when|whenever) you attack\b/,
  ].some((pattern) => pattern.test(normalized));
}

function splitInstructions(value: string): string[] {
  return value
    .replace(/\band you (gain|lose|pay)\b/gi, ". You $1")
    .split(/[.;]/)
    .map((entry) => entry.trim().replace(/^then\s+/i, ""))
    .filter(Boolean);
}

function parseLifeOutcome(clause: string): SupportedLifeOutcome | null {
  const match = clause.match(/^you\s+(gain|lose|pay)\s+([a-z]+|\d+)\s+life$/i);
  if (!match) return null;
  const amount = parseQuantity(match[2]);
  if (amount === null) return null;
  return {
    kind: "life",
    mode: match[1].toLowerCase() as SupportedLifeOutcome["mode"],
    amount,
  };
}

function parseTokenOutcome(clause: string): SupportedTokenOutcome | null {
  if (
    /\b(copy|for each|equal to|where x|unless|if |may |up to|choose)\b/i.test(
      clause,
    )
  ) {
    return null;
  }
  const match = clause.match(
    /^create\s+([a-z]+|\d+)\s+(.+?)\s+tokens?(?:\s+(tapped)(?:\s+and\s+(attacking))?)?$/i,
  );
  if (!match) return null;
  const quantity = parseQuantity(match[1]);
  if (quantity === null) return null;
  const descriptor = match[2].trim();
  const named = NAMED_NONCREATURE_TOKENS[descriptor.toLowerCase()];
  if (named) {
    return {
      kind: "token",
      quantity,
      name: named.name,
      power: 0,
      toughness: 0,
      cardTypes: [...named.cardTypes],
      subtypes: [...named.subtypes],
      colors: [],
      tapped: Boolean(match[3]),
      attacking: Boolean(match[4]),
    };
  }
  if (!/\bcreature\b/i.test(descriptor)) return null;
  const stats = descriptor.match(/\b(\d+)\s*\/\s*(\d+)\b/);
  if (!stats) return null;
  const colors = Object.entries(COLOR_WORDS)
    .filter(([word]) => new RegExp(`\\b${word}\\b`, "i").test(descriptor))
    .map(([, symbol]) => symbol);
  const cardTypes = /\bartifact\b/i.test(descriptor)
    ? ["Artifact", "Creature"]
    : ["Creature"];
  const subtypeText = descriptor
    .replace(stats[0], " ")
    .replace(
      /\b(white|blue|black|red|green|colorless|and|artifact|creature)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  const subtypes = subtypeText
    ? subtypeText.split(/\s+/).map(titleCase)
    : ["Creature"];
  return {
    kind: "token",
    quantity,
    name: subtypes.join(" "),
    power: Number(stats[1]),
    toughness: Number(stats[2]),
    cardTypes,
    subtypes,
    colors,
    tapped: Boolean(match[3]),
    attacking: Boolean(match[4]),
  };
}

function parseQuantity(value: string): number | null {
  const normalized = value.toLowerCase();
  const quantity = /^\d+$/.test(normalized)
    ? Number(normalized)
    : NUMBER_WORDS[normalized];
  return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 999
    ? quantity
    : null;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
