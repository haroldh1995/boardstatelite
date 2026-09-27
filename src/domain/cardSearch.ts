import type { CardIdentity } from "./types";

export const CARD_TYPES = [
  "Creature",
  "Land",
  "Artifact",
  "Enchantment",
  "Instant",
  "Sorcery",
  "Planeswalker",
  "Battle",
  "Kindred",
] as const;

export const CARD_SUPERTYPES = ["Legendary", "Basic", "Snow"] as const;
export const CARD_COLORS = [
  { value: "W", label: "White" },
  { value: "U", label: "Blue" },
  { value: "B", label: "Black" },
  { value: "R", label: "Red" },
  { value: "G", label: "Green" },
  { value: "C", label: "Colorless" },
] as const;

export const CARD_KEYWORDS = [
  "Deathtouch",
  "Defender",
  "Double Strike",
  "First Strike",
  "Flash",
  "Flying",
  "Haste",
  "Hexproof",
  "Indestructible",
  "Lifelink",
  "Menace",
  "Reach",
  "Trample",
  "Vigilance",
  "Ward",
] as const;

export interface CardSearchFilters {
  cardName: string;
  cardTypes: string[];
  subtype: string;
  supertypes: string[];
  colors: string[];
  colorIdentity: string[];
  manaValue: number | null;
  manaValueOperator: "exact" | "at-most" | "at-least";
  manaCost: string;
  oracleText: string;
  power: string;
  toughness: string;
  keywords: string[];
  rarity: string;
  set: string;
  artist: string;
  commanderColorIdentity: string[];
}

export type CardSearchConceptKind =
  | "type"
  | "subtype"
  | "supertype"
  | "color"
  | "mana-value"
  | "keyword";

export interface CardSearchConcept {
  id: string;
  kind: CardSearchConceptKind;
  label: string;
  value: string;
  sourceTerm: string;
}

export interface CardSearchRequest {
  query: string;
  filters?: CardSearchFilters;
  ignoredConceptIds?: readonly string[];
}

export interface CardSearchInterpretation {
  normalizedQuery: string;
  correctedQuery: string;
  concepts: CardSearchConcept[];
  textTerms: string[];
  corrections: Array<{ from: string; to: string }>;
}

export interface CardSearchStage {
  id: "exact" | "structured" | "broad" | "fuzzy" | "word";
  query: string;
}

const COLOR_WORDS: Record<string, string> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
  colorless: "C",
  colourless: "C",
};

const SUBTYPES = new Set([
  "angel",
  "aura",
  "beast",
  "cleric",
  "clue",
  "dinosaur",
  "dragon",
  "elf",
  "equipment",
  "food",
  "forest",
  "goblin",
  "human",
  "island",
  "mountain",
  "plains",
  "soldier",
  "spirit",
  "swamp",
  "treasure",
  "vampire",
  "warrior",
  "wizard",
  "zombie",
]);

const STRUCTURAL_VOCABULARY = [
  ...CARD_TYPES.map((value) => value.toLowerCase()),
  ...CARD_SUPERTYPES.map((value) => value.toLowerCase()),
  ...CARD_KEYWORDS.map((value) => value.toLowerCase()),
  ...Object.keys(COLOR_WORDS),
  ...SUBTYPES,
];

export function createDefaultCardSearchFilters(): CardSearchFilters {
  return {
    cardName: "",
    cardTypes: [],
    subtype: "",
    supertypes: [],
    colors: [],
    colorIdentity: [],
    manaValue: null,
    manaValueOperator: "exact",
    manaCost: "",
    oracleText: "",
    power: "",
    toughness: "",
    keywords: [],
    rarity: "",
    set: "",
    artist: "",
    commanderColorIdentity: [],
  };
}

export function hasActiveCardSearchFilters(
  filters: CardSearchFilters | undefined,
): boolean {
  if (!filters) return false;
  return (
    filters.cardName.trim().length > 0 ||
    filters.cardTypes.length > 0 ||
    filters.subtype.trim().length > 0 ||
    filters.supertypes.length > 0 ||
    filters.colors.length > 0 ||
    filters.colorIdentity.length > 0 ||
    filters.manaValue !== null ||
    filters.manaCost.trim().length > 0 ||
    filters.oracleText.trim().length > 0 ||
    filters.power.trim().length > 0 ||
    filters.toughness.trim().length > 0 ||
    filters.keywords.length > 0 ||
    filters.rarity.trim().length > 0 ||
    filters.set.trim().length > 0 ||
    filters.artist.trim().length > 0 ||
    filters.commanderColorIdentity.length > 0
  );
}

export function interpretCardSearch(
  request: CardSearchRequest,
): CardSearchInterpretation {
  const normalizedQuery = normalizeCardSearchText(request.query);
  const ignored = new Set(request.ignoredConceptIds ?? []);
  const rawTerms = normalizedQuery.split(" ").filter(Boolean);
  const corrections: Array<{ from: string; to: string }> = [];
  const correctedTerms = rawTerms.map((term) => {
    const corrected = correctStructuralTerm(term);
    if (corrected !== term) corrections.push({ from: term, to: corrected });
    return corrected;
  });
  const concepts: CardSearchConcept[] = [];
  const consumed = new Set<number>();

  for (let index = 0; index < correctedTerms.length - 1; index += 1) {
    const phrase = `${correctedTerms[index]} ${correctedTerms[index + 1]}`;
    const keyword = CARD_KEYWORDS.find(
      (candidate) => normalizeCardSearchText(candidate) === phrase,
    );
    if (!keyword) continue;
    addConcept(concepts, {
      id: `keyword:${keyword.toLowerCase().replace(/\s/g, "-")}`,
      kind: "keyword",
      label: keyword,
      value: keyword,
      sourceTerm: `${rawTerms[index]} ${rawTerms[index + 1]}`,
    });
    consumed.add(index);
    consumed.add(index + 1);
  }

  correctedTerms.forEach((term, index) => {
    if (consumed.has(index)) return;
    if (/^\d+$/.test(term) && correctedTerms[index + 1] === "mana") {
      addConcept(concepts, {
        id: `mana-value:${term}`,
        kind: "mana-value",
        label: `Mana ${term}`,
        value: term,
        sourceTerm: rawTerms[index] ?? term,
      });
      consumed.add(index);
      consumed.add(index + 1);
      return;
    }
    const color = COLOR_WORDS[term];
    if (color) {
      addConcept(concepts, {
        id: `color:${color}`,
        kind: "color",
        label: colorLabel(color),
        value: color,
        sourceTerm: rawTerms[index] ?? term,
      });
      consumed.add(index);
      return;
    }
    const cardType = CARD_TYPES.find(
      (candidate) => candidate.toLowerCase() === singularize(term),
    );
    if (cardType) {
      addConcept(concepts, {
        id: `type:${cardType.toLowerCase()}`,
        kind: "type",
        label: cardType,
        value: cardType,
        sourceTerm: rawTerms[index] ?? term,
      });
      consumed.add(index);
      return;
    }
    const supertype = CARD_SUPERTYPES.find(
      (candidate) => candidate.toLowerCase() === singularize(term),
    );
    if (supertype) {
      addConcept(concepts, {
        id: `supertype:${supertype.toLowerCase()}`,
        kind: "supertype",
        label: supertype,
        value: supertype,
        sourceTerm: rawTerms[index] ?? term,
      });
      consumed.add(index);
      return;
    }
    const keyword = CARD_KEYWORDS.find(
      (candidate) => normalizeCardSearchText(candidate) === singularize(term),
    );
    if (keyword) {
      addConcept(concepts, {
        id: `keyword:${keyword.toLowerCase().replace(/\s/g, "-")}`,
        kind: "keyword",
        label: keyword,
        value: keyword,
        sourceTerm: rawTerms[index] ?? term,
      });
      consumed.add(index);
      return;
    }
    const singular = singularize(term);
    if (SUBTYPES.has(singular)) {
      const label = titleCase(singular);
      addConcept(concepts, {
        id: `subtype:${singular}`,
        kind: "subtype",
        label,
        value: label,
        sourceTerm: rawTerms[index] ?? term,
      });
      consumed.add(index);
    }
  });

  const textTerms = correctedTerms.filter(
    (term, index) => !consumed.has(index) && term !== "mana",
  );
  const effectiveTerms = correctedTerms.filter((_term, index) => {
    const concept = concepts.find((entry) =>
      normalizeCardSearchText(entry.sourceTerm)
        .split(" ")
        .includes(rawTerms[index]),
    );
    return !concept || !ignored.has(concept.id);
  });

  return {
    normalizedQuery,
    correctedQuery: effectiveTerms.join(" "),
    concepts: concepts.filter((concept) => !ignored.has(concept.id)),
    textTerms,
    corrections,
  };
}

export function buildCardSearchPlan(
  request: CardSearchRequest,
): CardSearchStage[] {
  const interpretation = interpretCardSearch(request);
  const filters = request.filters ?? createDefaultCardSearchFilters();
  const filterQuery = buildFilterQuery(filters);
  const structuralQuery = buildStructuralQuery(interpretation.concepts);
  const queryText =
    interpretation.correctedQuery || interpretation.normalizedQuery;
  const stages: CardSearchStage[] = [];

  if (queryText && !hasActiveCardSearchFilters(filters)) {
    stages.push({ id: "exact", query: `!"${escapeQuery(queryText)}"` });
  }
  if (structuralQuery || filterQuery) {
    const text = interpretation.textTerms
      .map((term) => `(name:${quote(term)} or oracle:${quote(term)})`)
      .join(" ");
    stages.push({
      id: "structured",
      query: [filterQuery, structuralQuery, text].filter(Boolean).join(" "),
    });
  }
  if (queryText || filterQuery) {
    stages.push({
      id: "broad",
      query: [filterQuery, queryText ? broadQuery(queryText) : ""]
        .filter(Boolean)
        .join(" "),
    });
  }
  if (interpretation.corrections.length > 0) {
    stages.push({
      id: "fuzzy",
      query: [filterQuery, structuralQuery, broadQuery(queryText)]
        .filter(Boolean)
        .join(" "),
    });
  }
  [...new Set(queryText.split(" ").filter((term) => term.length > 1))]
    .slice(0, 4)
    .forEach((term) => {
      stages.push({
        id: "word",
        query: [filterQuery, `(name:${quote(term)} or oracle:${quote(term)})`]
          .filter(Boolean)
          .join(" "),
      });
    });

  const seen = new Set<string>();
  return stages.filter((stage) => {
    const value = stage.query.trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function rankCardSearchResults(
  request: CardSearchRequest,
  cards: readonly CardIdentity[],
): CardIdentity[] {
  return cards
    .map((card, index) => ({
      card,
      index,
      score: scoreCardSearchResult(request, card),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.card);
}

export function scoreCardSearchResult(
  request: CardSearchRequest,
  card: CardIdentity,
): number {
  const interpretation = interpretCardSearch(request);
  const filters = request.filters ?? createDefaultCardSearchFilters();
  const name = normalizeCardSearchText(card.name);
  const typeLine = normalizeCardSearchText(card.typeLine);
  const oracle = normalizeCardSearchText(card.oracleText);
  const flavor = normalizeCardSearchText(card.flavorText ?? "");
  const metadata = normalizeCardSearchText(
    `${card.setCode ?? ""} ${card.setName ?? ""} ${card.collectorNumber ?? ""} ${card.artist ?? ""}`,
  );
  const query = interpretation.correctedQuery || interpretation.normalizedQuery;
  let score = 0;

  if (query && name === query) score += 5_000;
  else if (query && name.startsWith(query)) score += 2_000;
  else if (query && name.includes(query)) score += 1_300;
  else if (query && oracle.includes(query)) score += 500;
  else if (query && flavor.includes(query)) score += 240;
  else if (query && `${typeLine} ${metadata}`.includes(query)) score += 120;

  for (const concept of interpretation.concepts) {
    const matches = conceptMatchesCard(concept, card, typeLine);
    score += matches
      ? conceptWeight(concept.kind)
      : -conceptWeight(concept.kind) * 0.55;
  }
  for (const term of interpretation.textTerms) {
    const singular = singularize(term);
    if (name.split(" ").some((word) => singularize(word) === singular))
      score += 220;
    else if (name.includes(term)) score += 160;
    else if (oracle.includes(term)) score += 70;
    else if (flavor.includes(term)) score += 28;
    else if (`${typeLine} ${metadata}`.includes(term)) score += 35;
  }
  if (query && fuzzyPhraseMatch(name, query)) score += 360;

  score += scoreFilters(filters, card, { name, typeLine, oracle, metadata });
  return score;
}

export function hasSufficientCardSearchResults(
  request: CardSearchRequest,
  cards: readonly CardIdentity[],
): boolean {
  if (
    cards.some(
      (card) =>
        normalizeCardSearchText(card.name) ===
        normalizeCardSearchText(request.query),
    )
  ) {
    return true;
  }
  return (
    cards.filter((card) => scoreCardSearchResult(request, card) >= 650)
      .length >= 8
  );
}

export function deduplicateCardSearchResults(
  cards: readonly CardIdentity[],
): CardIdentity[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key =
      card.cardId ||
      `${card.oracleId ?? normalizeCardSearchText(card.name)}:${card.setCode ?? ""}:${card.collectorNumber ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeCardSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9+/-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildStructuralQuery(concepts: readonly CardSearchConcept[]): string {
  return concepts
    .map((concept) => {
      if (concept.kind === "color") {
        return concept.value === "C"
          ? "c:c"
          : `c:${concept.value.toLowerCase()}`;
      }
      if (concept.kind === "mana-value") return `mv=${concept.value}`;
      if (concept.kind === "keyword") return `kw:${quote(concept.value)}`;
      return `t:${quote(concept.value)}`;
    })
    .join(" ");
}

function buildFilterQuery(filters: CardSearchFilters): string {
  const result: string[] = [];
  if (filters.cardName.trim()) result.push(`name:${quote(filters.cardName)}`);
  filters.cardTypes.forEach((value) => result.push(`t:${quote(value)}`));
  if (filters.subtype.trim()) result.push(`t:${quote(filters.subtype)}`);
  filters.supertypes.forEach((value) => result.push(`t:${quote(value)}`));
  filters.colors.forEach((value) =>
    result.push(value === "C" ? "c:c" : `c:${value.toLowerCase()}`),
  );
  if (filters.colorIdentity.length) {
    result.push(`id:${filters.colorIdentity.join("").toLowerCase()}`);
  }
  if (filters.commanderColorIdentity.length) {
    result.push(`id<=${filters.commanderColorIdentity.join("").toLowerCase()}`);
  }
  if (filters.manaValue !== null) {
    const operator =
      filters.manaValueOperator === "at-most"
        ? "<="
        : filters.manaValueOperator === "at-least"
          ? ">="
          : "=";
    result.push(`mv${operator}${filters.manaValue}`);
  }
  if (filters.manaCost.trim()) result.push(`mana:${quote(filters.manaCost)}`);
  if (filters.oracleText.trim())
    result.push(`oracle:${quote(filters.oracleText)}`);
  if (filters.power.trim()) result.push(`pow=${filters.power.trim()}`);
  if (filters.toughness.trim()) result.push(`tou=${filters.toughness.trim()}`);
  filters.keywords.forEach((value) => result.push(`kw:${quote(value)}`));
  if (filters.rarity.trim()) result.push(`r:${filters.rarity.toLowerCase()}`);
  if (filters.set.trim()) result.push(`e:${quote(filters.set)}`);
  if (filters.artist.trim()) result.push(`a:${quote(filters.artist)}`);
  return result.join(" ");
}

function scoreFilters(
  filters: CardSearchFilters,
  card: CardIdentity,
  normalized: {
    name: string;
    typeLine: string;
    oracle: string;
    metadata: string;
  },
): number {
  let score = 0;
  score += textFilterScore(filters.cardName, normalized.name, 1_000);
  filters.cardTypes.forEach((value) => {
    score += normalized.typeLine.includes(normalizeCardSearchText(value))
      ? 750
      : -900;
  });
  score += textFilterScore(filters.subtype, normalized.typeLine, 650);
  filters.supertypes.forEach((value) => {
    score += normalized.typeLine.includes(normalizeCardSearchText(value))
      ? 650
      : -800;
  });
  filters.colors.forEach((value) => {
    score +=
      card.colors.includes(value) || (value === "C" && card.colors.length === 0)
        ? 500
        : -650;
  });
  filters.colorIdentity.forEach((value) => {
    score += card.colorIdentity.includes(value) ? 500 : -650;
  });
  if (filters.commanderColorIdentity.length) {
    const compatible = card.colorIdentity.every((value) =>
      filters.commanderColorIdentity.includes(value),
    );
    score += compatible ? 450 : -900;
  }
  if (filters.manaValue !== null) {
    const matches =
      filters.manaValueOperator === "at-most"
        ? card.manaValue <= filters.manaValue
        : filters.manaValueOperator === "at-least"
          ? card.manaValue >= filters.manaValue
          : card.manaValue === filters.manaValue;
    score += matches ? 600 : -850;
  }
  score += textFilterScore(filters.manaCost, card.manaCost, 450);
  score += textFilterScore(filters.oracleText, normalized.oracle, 550);
  if (filters.power.trim())
    score += card.power === filters.power.trim() ? 450 : -550;
  if (filters.toughness.trim())
    score += card.toughness === filters.toughness.trim() ? 450 : -550;
  filters.keywords.forEach((value) => {
    score += card.keywords.some(
      (keyword) =>
        normalizeCardSearchText(keyword) === normalizeCardSearchText(value),
    )
      ? 600
      : -700;
  });
  score += textFilterScore(filters.rarity, card.rarity ?? "", 300);
  score += textFilterScore(
    filters.set,
    `${card.setCode ?? ""} ${card.setName ?? ""}`,
    300,
  );
  score += textFilterScore(filters.artist, card.artist ?? "", 300);
  return score;
}

function conceptMatchesCard(
  concept: CardSearchConcept,
  card: CardIdentity,
  typeLine: string,
): boolean {
  const value = normalizeCardSearchText(concept.value);
  if (
    concept.kind === "type" ||
    concept.kind === "subtype" ||
    concept.kind === "supertype"
  ) {
    return typeLine
      .split(/\s+|[-—]/)
      .some((term) => singularize(term) === singularize(value));
  }
  if (concept.kind === "color") {
    return concept.value === "C"
      ? card.colors.length === 0
      : card.colors.includes(concept.value);
  }
  if (concept.kind === "mana-value")
    return card.manaValue === Number(concept.value);
  return card.keywords.some(
    (keyword) => normalizeCardSearchText(keyword) === value,
  );
}

function conceptWeight(kind: CardSearchConceptKind): number {
  if (kind === "type" || kind === "subtype" || kind === "supertype") return 850;
  if (kind === "mana-value") return 700;
  if (kind === "color") return 620;
  return 580;
}

function addConcept(concepts: CardSearchConcept[], concept: CardSearchConcept) {
  if (!concepts.some((entry) => entry.id === concept.id)) {
    concepts.push(concept);
  }
}

function broadQuery(value: string): string {
  return `(name:${quote(value)} or oracle:${quote(value)} or flavor:${quote(value)})`;
}

function quote(value: string): string {
  return `"${escapeQuery(value.trim())}"`;
}

function escapeQuery(value: string): string {
  return value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
}

function textFilterScore(
  value: string,
  target: string,
  weight: number,
): number {
  const normalizedValue = normalizeCardSearchText(value);
  if (!normalizedValue) return 0;
  return normalizeCardSearchText(target).includes(normalizedValue)
    ? weight
    : -weight;
}

function singularize(value: string): string {
  const normalized = normalizeCardSearchText(value);
  if (normalized.endsWith("ies") && normalized.length > 4)
    return `${normalized.slice(0, -3)}y`;
  if (
    normalized.endsWith("s") &&
    !normalized.endsWith("ss") &&
    normalized.length > 3
  ) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function correctStructuralTerm(term: string): string {
  const singular = singularize(term);
  if (STRUCTURAL_VOCABULARY.includes(singular)) return singular;
  if (term.length < 5) return term;
  let best = term;
  let bestDistance = 3;
  for (const candidate of STRUCTURAL_VOCABULARY) {
    if (candidate[0] !== term[0]) continue;
    const distance = levenshtein(term, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= 2 ? best : term;
}

function fuzzyPhraseMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (levenshtein(left, right) <= Math.max(1, Math.floor(right.length / 7)))
    return true;
  return right
    .split(" ")
    .filter((term) => term.length >= 4)
    .every((term) =>
      left.split(" ").some((word) => levenshtein(word, term) <= 2),
    );
}

function levenshtein(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[right.length];
}

function colorLabel(value: string): string {
  return CARD_COLORS.find((entry) => entry.value === value)?.label ?? value;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
