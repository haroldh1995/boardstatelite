import type { FieldState } from "../domain/types";
import type {
  AthenaReconciliationRepair,
  AthenaStructuredCorrectionIntent,
} from "../athena/reconciliationTypes";

type ReconciliationRepairInput = AthenaReconciliationRepair extends infer Repair
  ? Repair extends AthenaReconciliationRepair
    ? Omit<Repair, "id">
    : never
  : never;

const NUMBER_WORDS: Record<string, number> = {
  no: 0,
  zero: 0,
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
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

export function parseEchoReconciliationCommand(input: {
  transcript: string;
  field: FieldState;
  speakerVerified: boolean;
  catchUpMode?: boolean;
  timestamp?: string;
}): AthenaStructuredCorrectionIntent {
  const timestamp = input.timestamp ?? input.field.updatedAt;
  const transcript = input.transcript.trim();
  const normalized = normalize(transcript);
  const id = stableId(
    "echo-reconciliation",
    `${input.field.session.id}:${timestamp}:${normalized}`,
  );
  if (!input.speakerVerified) {
    return intent(id, transcript, timestamp, false, "unrecognized", [], null);
  }
  if (isAmbiguousMissedAction(normalized)) {
    return intent(
      id,
      transcript,
      timestamp,
      true,
      "clarification-required",
      [],
      "Correct the board only, or process the missed play?",
    );
  }
  if (isCatchUpCommand(normalized) && !hasStateStatement(normalized)) {
    return intent(id, transcript, timestamp, true, "catch-me-up", [], null);
  }
  const correctionMarked =
    input.catchUpMode === true ||
    /\b(correction|actually|should be|catch me up)\b/.test(normalized);
  if (!correctionMarked) {
    return intent(
      id,
      transcript,
      timestamp,
      true,
      looksLikeRealAction(normalized) ? "real-game-action" : "unrecognized",
      [],
      null,
    );
  }

  const repairs: AthenaReconciliationRepair[] = [];
  const add = (repair: ReconciliationRepairInput) => {
    repairs.push({
      ...repair,
      id: stableId("voice-repair", `${id}:${repairs.length}:${repair.kind}`),
    } as AthenaReconciliationRepair);
  };
  const life = valueForSubject(normalized, ["life"]);
  if (life !== null) add({ kind: "set-life", value: life });
  const commanderDamage = valueForSubject(normalized, [
    "commander damage",
    "cmd damage",
  ]);
  if (commanderDamage !== null) {
    add({
      kind: "set-player-counter",
      counter: "commanderDamage",
      value: commanderDamage,
    });
  }
  const lands = valueForSubject(normalized, ["lands", "land"]);
  if (lands !== null)
    add({ kind: "set-relevant-total", key: "lands", value: lands });
  const hand = valueForSubject(normalized, ["cards in hand", "hand"]);
  if (hand !== null)
    add({ kind: "set-relevant-total", key: "cardsInHand", value: hand });
  const treasures = valueForSubject(normalized, ["treasures", "treasure"]);
  if (treasures !== null)
    add({
      kind: "set-relevant-total",
      key: "treasureTokens",
      value: treasures,
    });
  const graveyardTotal = valueForSubject(normalized, [
    "cards in graveyard",
    "graveyard total",
    "graveyard",
  ]);
  const graveyardCreatures = categoryValue(
    normalized,
    "graveyard",
    "creatures?",
  );
  if (graveyardTotal !== null || graveyardCreatures !== null) {
    add({
      kind: "set-zone-composition",
      zone: "graveyard",
      ...(graveyardTotal !== null ? { physicalTotal: graveyardTotal } : {}),
      ...(graveyardCreatures !== null
        ? { categoryTotals: { creature: graveyardCreatures } }
        : {}),
    });
  }
  const exileTotal = valueForSubject(normalized, [
    "cards in exile",
    "exile total",
    "exile",
  ]);
  if (exileTotal !== null) {
    add({
      kind: "set-zone-composition",
      zone: "exile",
      physicalTotal: exileTotal,
    });
  }

  for (const group of input.field.groups.filter(
    (entry) => entry.zone === "battlefield",
  )) {
    const label = normalize(group.label);
    if (!label || !normalized.includes(label)) continue;
    const counterValue = counterValueForGroup(normalized, label);
    if (counterValue !== null) {
      add({
        kind: "set-counter",
        groupId: group.id,
        counter: "+1/+1",
        value: counterValue,
      });
      continue;
    }
    const quantity = valueForSubject(
      normalized,
      label.endsWith("s") ? [label] : [label, `${label}s`],
    );
    if (quantity !== null) {
      add({
        kind: "set-group-quantity",
        groupId: group.id,
        value: quantity,
      });
    }
  }

  return intent(
    id,
    transcript,
    timestamp,
    true,
    repairs.length > 0
      ? input.catchUpMode || isCatchUpCommand(normalized)
        ? "catch-me-up"
        : "correction"
      : "unrecognized",
    dedupeRepairs(repairs),
    repairs.length > 0 ? null : "What current value should Lite show?",
  );
}

function intent(
  id: string,
  transcript: string,
  createdAt: string,
  speakerVerified: boolean,
  disposition: AthenaStructuredCorrectionIntent["disposition"],
  repairs: AthenaReconciliationRepair[],
  semanticPrompt: string | null,
): AthenaStructuredCorrectionIntent {
  return {
    id,
    disposition,
    source: "echo-structured-intent",
    transcript,
    repairs,
    semanticPrompt,
    correctionOnly:
      disposition === "correction" || disposition === "catch-me-up",
    speakerVerified,
    createdAt,
  };
}

function valueForSubject(text: string, subjects: string[]): number | null {
  for (const subject of subjects.sort(
    (left, right) => right.length - left.length,
  )) {
    const escaped = escapeRegExp(subject);
    const before = text.match(
      new RegExp(`\\b(${numberPattern()})\\s+${escaped}\\b`),
    );
    if (before) return parseNumber(before[1]);
    const have = text.match(
      new RegExp(
        `\\b(?:i|we)\\s+(?:have|should have)\\s+(${numberPattern()})\\s+${escaped}\\b`,
      ),
    );
    if (have) return parseNumber(have[1]);
    const after = text.match(
      new RegExp(
        `\\b${escaped}\\b(?:\\s+(?:is|are|has|have|should be|should have|equals?|at|to))?\\s+(${numberPattern()})\\b`,
      ),
    );
    if (after) return parseNumber(after[1]);
  }
  return null;
}

function categoryValue(
  text: string,
  zone: string,
  categoryPattern: string,
): number | null {
  const patterns = [
    new RegExp(
      `\\b${zone}\\b.{0,48}\\bwith\\s+(${numberPattern()})\\s+${categoryPattern}\\b`,
    ),
    new RegExp(
      `\\b${zone}\\b(?:\\s+has|\\s+contains|\\s+with)?\\s+(${numberPattern()})\\s+${categoryPattern}\\b`,
    ),
    new RegExp(
      `\\b(${numberPattern()})\\s+${categoryPattern}\\s+(?:in|inside)\\s+(?:my\\s+)?${zone}\\b`,
    ),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseNumber(match[1]);
  }
  return null;
}

function counterValueForGroup(text: string, label: string): number | null {
  const escaped = escapeRegExp(label);
  const patterns = [
    new RegExp(
      `\\b${escaped}\\b(?:\\s+(?:has|have|should have))?\\s+(${numberPattern()})\\s+(?:\\+1/\\+1\\s+)?counters?\\b`,
    ),
    new RegExp(
      `\\b(${numberPattern()})\\s+(?:\\+1/\\+1\\s+)?counters?\\s+(?:on\\s+)?${escaped}\\b`,
    ),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseNumber(match[1]);
  }
  return null;
}

function parseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  const normalized = value.trim().toLowerCase().replace(/-/g, " ");
  if (NUMBER_WORDS[normalized] !== undefined) return NUMBER_WORDS[normalized];
  const parts = normalized.split(/\s+/);
  let total = 0;
  for (const part of parts) {
    const next = NUMBER_WORDS[part];
    if (next === undefined) return null;
    if (next === 100) total = Math.max(1, total) * 100;
    else total += next;
  }
  return total;
}

function numberPattern(): string {
  return `(?:\\d{1,6}|${Object.keys(NUMBER_WORDS).join("|")})(?:[ -](?:${Object.keys(NUMBER_WORDS).join("|")}))*`;
}

function isCatchUpCommand(text: string): boolean {
  return /\bcatch me up\b/.test(text);
}

function hasStateStatement(text: string): boolean {
  return /\b(life|lands?|treasures?|graveyard|exile|counters?|should be|actually)\b/.test(
    text.replace(/\bcatch me up\b/, ""),
  );
}

function isAmbiguousMissedAction(text: string): boolean {
  return /\b(?:forgot|missed|did not record|didn't record)\b.*\b(?:play|played|cast|sacrifice|sacrificed|draw|drew)\b/.test(
    text,
  );
}

function looksLikeRealAction(text: string): boolean {
  return /^(?:i(?:'ll| will)?\s+)?(?:play|cast|sacrifice|sac|draw|attack|combat)\b/.test(
    text,
  );
}

function dedupeRepairs(
  repairs: AthenaReconciliationRepair[],
): AthenaReconciliationRepair[] {
  const keys = new Set<string>();
  return repairs.filter((repair) => {
    const key =
      repair.kind === "set-group-quantity" || repair.kind === "set-counter"
        ? `${repair.kind}:${repair.groupId}`
        : repair.kind === "set-relevant-total"
          ? `${repair.kind}:${repair.key}`
          : repair.kind === "set-zone-composition"
            ? `${repair.kind}:${repair.zone}`
            : repair.kind;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9+/' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stableId(prefix: string, value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`;
}
