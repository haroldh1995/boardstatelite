import { makeId } from "../domain/cards";
import type { Zone } from "../domain/types";
import { normalizeAmbientConfidence } from "./ambientConfidence";
import type { AmbientGameplayMode } from "./ambientTypes";
import type {
  AmbientConfidenceAssessment,
  AmbientConfidenceLevel,
} from "./ambientConfidenceTypes";
import type {
  AmbientEntityReference,
  AmbientIntentInput,
  AmbientIntentKind,
} from "./ambientEventTypes";
import {
  ECHO_MAGIC_COMMAND_GRAMMAR_VERSION,
  type EchoMagicCommandAction,
  type EchoMagicCommandAmbiguity,
  type EchoMagicCommandGrammarDiagnostics,
  type EchoMagicCommandGrammarInput,
  type EchoMagicCommandGrammarResult,
  type EchoMagicCommandGrammarSettings,
  type EchoMagicCommandObject,
  type EchoMagicCommandObjectKind,
  type EchoMagicCommandObjectMatch,
  type EchoMagicCommandParseInput,
} from "./magicCommandGrammarTypes";

type GrammarField = EchoMagicCommandGrammarInput["field"];

interface CommandDefinition {
  action: EchoMagicCommandAction;
  intentKind: AmbientIntentKind;
  aliases: string[];
  requiresObject: boolean;
  defaultQuantity: number | null;
  requiredMode: AmbientGameplayMode | null;
  expectedObjectKinds: EchoMagicCommandObjectKind[];
}

const DEFAULT_SETTINGS: EchoMagicCommandGrammarSettings = {
  version: ECHO_MAGIC_COMMAND_GRAMMAR_VERSION,
  enabled: false,
  requireVerifiedSpeaker: true,
  locale: "en-US",
  diagnosticsEnabled: false,
  testingEnabled: false,
  languageSelectionPrepared: true,
  lastResetAt: null,
  lastRecognizedAt: null,
};

const BASIC_LANDS = new Set([
  "plains",
  "island",
  "swamp",
  "mountain",
  "forest",
  "wastes",
]);

const COUNTER_ALIASES = new Map<string, string>([
  ["+1/+1", "+1/+1"],
  ["plus one plus one", "+1/+1"],
  ["one one", "+1/+1"],
  ["minus one minus one", "-1/-1"],
  ["negative one negative one", "-1/-1"],
  ["shield", "Shield"],
  ["stun", "Stun"],
  ["loyalty", "Loyalty"],
  ["charge", "Charge"],
  ["oil", "Oil"],
  ["time", "Time"],
  ["lore", "Lore"],
  ["quest", "Quest"],
  ["finality", "Finality"],
]);

const ZONE_ALIASES = new Map<string, string>([
  ["battlefield", "battlefield"],
  ["field", "battlefield"],
  ["graveyard", "graveyard"],
  ["yard", "graveyard"],
  ["exile", "exile"],
  ["hand", "hand"],
  ["library", "library"],
  ["deck", "library"],
  ["command zone", "command"],
  ["command", "command"],
]);

const PLAYER_ALIASES = new Map<string, "you" | "opponent">([
  ["me", "you"],
  ["myself", "you"],
  ["my", "you"],
  ["you", "you"],
  ["opponent", "opponent"],
  ["an opponent", "opponent"],
  ["target opponent", "opponent"],
]);

const MANA_COLORS = new Map<string, string>([
  ["white", "W"],
  ["blue", "U"],
  ["black", "B"],
  ["red", "R"],
  ["green", "G"],
  ["colorless", "C"],
  ["generic", "generic"],
]);

const NUMBER_WORDS = new Map<string, number>([
  ["zero", 0],
  ["a", 1],
  ["an", 1],
  ["one", 1],
  ["single", 1],
  ["two", 2],
  ["couple", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
]);

const COMMAND_DEFINITIONS: CommandDefinition[] = [
  definition("end-turn", "end-turn", [
    "end my turn",
    "end turn",
    "i am done",
    "i am finished",
    "i pass the turn",
    "pass the turn",
    "go ahead",
    "your go",
    "done",
    "pass",
  ]),
  definition("pass-priority", "pass-priority", [
    "pass priority",
    "pass priority to you",
    "pass priority to opponent",
  ]),
  definition("hold-priority", "hold-priority", [
    "hold priority",
    "retain priority",
  ]),
  definition("play", "play-land", ["play", "drop", "put down"], {
    requiresObject: true,
    expectedObjectKinds: ["land", "card", "battlefield-object"],
  }),
  definition("cast", "cast-spell", ["cast", "pay for"], {
    requiresObject: true,
    expectedObjectKinds: ["card"],
  }),
  definition("attack", "attack", ["attack with", "swing with", "attack"], {
    requiresObject: true,
    requiredMode: "combat",
    expectedObjectKinds: ["battlefield-object", "commander"],
  }),
  definition("block", "block", ["block with", "block"], {
    requiresObject: true,
    requiredMode: "combat",
    expectedObjectKinds: ["battlefield-object", "commander"],
  }),
  definition("create", "create-token", ["create", "make"], {
    requiresObject: true,
    defaultQuantity: 1,
    expectedObjectKinds: ["token"],
  }),
  definition("sacrifice", "sacrifice-permanent", ["sacrifice", "sac"], {
    requiresObject: true,
    expectedObjectKinds: ["battlefield-object"],
  }),
  definition("destroy", "destroy-permanent", ["destroy", "kill"], {
    requiresObject: true,
    expectedObjectKinds: ["battlefield-object"],
  }),
  definition("exile", "exile-permanent", ["exile"], {
    requiresObject: true,
    expectedObjectKinds: ["battlefield-object", "card"],
  }),
  definition("return", "return-permanent", ["return", "bounce"], {
    requiresObject: true,
    expectedObjectKinds: ["battlefield-object", "card"],
  }),
  definition("draw", "draw-cards", ["draw"], {
    defaultQuantity: 1,
  }),
  definition("discard", "discard-cards", ["discard"], {
    defaultQuantity: 1,
    expectedObjectKinds: ["card"],
  }),
  definition("untap", "untap", ["untap"], {
    requiresObject: true,
    expectedObjectKinds: ["battlefield-object", "land"],
  }),
  definition("tap", "tap", ["tap"], {
    requiresObject: true,
    expectedObjectKinds: ["battlefield-object", "land"],
  }),
  definition("add-counter", "add-counters", ["add", "put"], {
    requiresObject: true,
    defaultQuantity: 1,
    expectedObjectKinds: ["counter"],
  }),
  definition("remove-counter", "remove-counters", ["remove"], {
    requiresObject: true,
    defaultQuantity: 1,
    expectedObjectKinds: ["counter"],
  }),
  definition("counter-spell", "counter-spell", ["counter"], {
    requiresObject: true,
    expectedObjectKinds: ["card"],
  }),
  definition("activate", "activate-ability", ["activate"], {
    requiresObject: true,
    expectedObjectKinds: ["battlefield-object", "card"],
  }),
  definition("equip", "equip", ["equip"], {
    requiresObject: true,
    expectedObjectKinds: ["battlefield-object"],
  }),
  definition("attach", "attach", ["attach"], {
    requiresObject: true,
    expectedObjectKinds: ["battlefield-object"],
  }),
  definition("transform", "transform-permanent", ["transform", "flip"], {
    requiresObject: true,
    expectedObjectKinds: ["battlefield-object"],
  }),
  definition("explore", "explore", ["explore"], {
    requiresObject: true,
    expectedObjectKinds: ["battlefield-object", "commander"],
  }),
  definition("surveil", "surveil", ["surveil"], {
    defaultQuantity: 1,
  }),
  definition("mill", "mill-cards", ["mill"], {
    defaultQuantity: 1,
  }),
];

const SORTED_DEFINITIONS = [...COMMAND_DEFINITIONS].sort(
  (left, right) =>
    Math.max(...right.aliases.map((alias) => alias.length)) -
    Math.max(...left.aliases.map((alias) => alias.length)),
);

export function createDefaultMagicCommandGrammarSettings(
  overrides: Partial<EchoMagicCommandGrammarSettings> = {},
): EchoMagicCommandGrammarSettings {
  return normalizeMagicCommandGrammarSettings({
    ...DEFAULT_SETTINGS,
    ...overrides,
  });
}

export function normalizeMagicCommandGrammarSettings(
  value: unknown,
): EchoMagicCommandGrammarSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  const candidate = value as Partial<EchoMagicCommandGrammarSettings>;
  return {
    ...DEFAULT_SETTINGS,
    enabled: Boolean(candidate.enabled),
    requireVerifiedSpeaker:
      typeof candidate.requireVerifiedSpeaker === "boolean"
        ? candidate.requireVerifiedSpeaker
        : DEFAULT_SETTINGS.requireVerifiedSpeaker,
    locale: candidate.locale === "en-US" ? candidate.locale : "en-US",
    diagnosticsEnabled: Boolean(candidate.diagnosticsEnabled),
    testingEnabled: Boolean(candidate.testingEnabled),
    languageSelectionPrepared: true,
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
    lastRecognizedAt:
      typeof candidate.lastRecognizedAt === "string"
        ? candidate.lastRecognizedAt
        : null,
  };
}

export function parseMagicCommand(
  input: EchoMagicCommandParseInput,
): EchoMagicCommandGrammarResult {
  return parseRecognizedCommand({
    ...input,
    speakerVerification: null,
    settings: createDefaultMagicCommandGrammarSettings({
      enabled: true,
      requireVerifiedSpeaker: false,
    }),
  });
}

export function recognizeMagicCommand(
  input: EchoMagicCommandGrammarInput,
): EchoMagicCommandGrammarResult {
  const settings = normalizeMagicCommandGrammarSettings(input.settings);
  const timestamp = input.timestamp ?? new Date().toISOString();
  if (!settings.enabled) {
    return createTerminalResult({
      input,
      timestamp,
      settings,
      status: "disabled",
      message: "Magic command grammar is disabled.",
      level: "unknown",
      speakerAccepted: !settings.requireVerifiedSpeaker,
    });
  }
  if (
    settings.requireVerifiedSpeaker &&
    (!input.speakerVerification || !input.speakerVerification.verified)
  ) {
    return createTerminalResult({
      input,
      timestamp,
      settings,
      status: "rejected",
      message:
        "Speaker verification must pass before Magic command grammar can interpret gameplay.",
      level: "unknown",
      speakerAccepted: false,
    });
  }
  return parseRecognizedCommand(input);
}

export function magicCommandResultToAmbientIntent(
  result: EchoMagicCommandGrammarResult,
): AmbientIntentInput | null {
  return result.intent ? structuredClone(result.intent) : null;
}

export class EchoMagicCommandGrammarEngine {
  private settings: EchoMagicCommandGrammarSettings;
  private recognizedCount = 0;
  private lastStatus: EchoMagicCommandGrammarResult["status"] | null = null;
  private lastIntentKind: AmbientIntentKind | null = null;
  private lastError: string | null = null;

  constructor(settings: unknown = undefined) {
    this.settings = normalizeMagicCommandGrammarSettings(settings);
  }

  hydrate(settings: unknown): EchoMagicCommandGrammarSettings {
    this.settings = normalizeMagicCommandGrammarSettings(settings);
    return this.getSettings();
  }

  getSettings(): EchoMagicCommandGrammarSettings {
    return { ...this.settings };
  }

  updateSettings(
    settings: Partial<EchoMagicCommandGrammarSettings>,
  ): EchoMagicCommandGrammarSettings {
    this.settings = normalizeMagicCommandGrammarSettings({
      ...this.settings,
      ...settings,
    });
    return this.getSettings();
  }

  recognize(
    input: EchoMagicCommandGrammarInput,
  ): EchoMagicCommandGrammarResult {
    const result = recognizeMagicCommand({
      ...input,
      settings: input.settings ?? this.settings,
    });
    this.remember(result);
    if (result.status !== "disabled") {
      this.settings = {
        ...this.settings,
        lastRecognizedAt: result.confidence.assessedAt,
      };
    }
    return result;
  }

  parse(input: EchoMagicCommandParseInput): EchoMagicCommandGrammarResult {
    const result = parseMagicCommand(input);
    this.remember(result);
    return result;
  }

  reset(timestamp = new Date().toISOString()): EchoMagicCommandGrammarSettings {
    this.settings = {
      ...createDefaultMagicCommandGrammarSettings(this.settings),
      lastResetAt: timestamp,
      lastRecognizedAt: null,
    };
    this.lastStatus = null;
    this.lastIntentKind = null;
    this.lastError = null;
    this.recognizedCount = 0;
    return this.getSettings();
  }

  diagnostics(): EchoMagicCommandGrammarDiagnostics {
    return {
      version: ECHO_MAGIC_COMMAND_GRAMMAR_VERSION,
      enabled: this.settings.enabled,
      requireVerifiedSpeaker: this.settings.requireVerifiedSpeaker,
      locale: this.settings.locale,
      lastRecognizedAt: this.settings.lastRecognizedAt,
      lastStatus: this.lastStatus,
      lastIntentKind: this.lastIntentKind,
      lastError: this.lastError,
      recognizedCount: this.recognizedCount,
      directBattlefieldMutation: false,
    };
  }

  private remember(result: EchoMagicCommandGrammarResult): void {
    this.lastStatus = result.status;
    this.lastIntentKind = result.intentKind;
    this.lastError = result.errors[0] ?? null;
    if (result.status === "recognized") this.recognizedCount += 1;
  }
}

export const echoMagicCommandGrammarEngine =
  new EchoMagicCommandGrammarEngine();

function parseRecognizedCommand(
  input: EchoMagicCommandGrammarInput,
): EchoMagicCommandGrammarResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const settings = normalizeMagicCommandGrammarSettings({
    ...createDefaultMagicCommandGrammarSettings({
      enabled: true,
      requireVerifiedSpeaker: false,
    }),
    ...input.settings,
  });
  const originalPhrase = sanitizePhrase(input.transcript);
  const normalizedPhrase = normalizePhrase(originalPhrase);
  if (!normalizedPhrase) {
    return createTerminalResult({
      input,
      timestamp,
      settings,
      status: "incomplete",
      message: "Magic command phrase was empty.",
      level: "unknown",
      speakerAccepted: speakerAccepted(input, settings),
    });
  }

  const match = matchCommandDefinition(normalizedPhrase, input.field);
  if (!match) {
    return buildUnknownCommandResult({
      input,
      timestamp,
      settings,
      originalPhrase,
      normalizedPhrase,
    });
  }

  const primaryText = primaryObjectText(match.remainder, match.definition);
  const counterObject = counterObjectForCommand(
    normalizedPhrase,
    input.field,
    timestamp,
  );
  const targetText = targetObjectText(normalizedPhrase);
  const quantity =
    extractQuantity(normalizedPhrase) ?? match.definition.defaultQuantity;
  const primaryObject =
    match.definition.action === "add-counter" ||
    match.definition.action === "remove-counter"
      ? counterObject
      : resolveCommandObject({
          text: primaryText,
          field: input.field,
          action: match.definition.action,
          expectedKinds: match.definition.expectedObjectKinds,
        });
  const targetObject =
    targetText && targetText !== primaryText
      ? resolveCommandObject({
          text: targetText,
          field: input.field,
          action: match.definition.action,
          expectedKinds: ["battlefield-object", "commander", "player"],
        })
      : null;
  const secondaryObject = secondaryObjectForCommand({
    phrase: normalizedPhrase,
    field: input.field,
    action: match.definition.action,
    primaryText,
    targetText,
  });
  const ambiguities = collectAmbiguities({
    definition: match.definition,
    normalizedPhrase,
    primaryObject,
    targetObject,
    secondaryObject,
    quantity,
    mode: input.field.ambient.currentMode,
  });
  const status = statusForCommand(match.definition, primaryObject, ambiguities);
  const level = confidenceLevelForCommand({
    status,
    matchInferredFromContext: match.inferredFromContext,
    ambiguities,
    speakerVerification: input.speakerVerification,
  });
  const confidence = createCommandConfidence({
    timestamp,
    level,
    score: scoreForLevel(level, input.speakerVerification?.score ?? null),
    reasons: confidenceReasons(status, match.definition, ambiguities, match),
    warningCount: ambiguities.length,
  });
  const errors =
    status === "unknown" || status === "incomplete"
      ? ambiguities.map((entry) => entry.message)
      : [];
  const intent =
    status === "recognized" || status === "ambiguous" || status === "incomplete"
      ? createIntent({
          definition: match.definition,
          timestamp,
          originalPhrase,
          normalizedPhrase,
          interpretedPhrase: match.interpretedPhrase,
          primaryObject,
          secondaryObject,
          targetObject,
          quantity,
          confidence,
          ambiguities,
          status,
        })
      : null;

  return {
    version: ECHO_MAGIC_COMMAND_GRAMMAR_VERSION,
    resultId: makeId("magic-command"),
    status,
    action: match.definition.action,
    intentKind: match.definition.intentKind,
    intent,
    originalPhrase,
    normalizedPhrase,
    interpretedPhrase: match.interpretedPhrase,
    quantity,
    primaryObject,
    secondaryObject,
    targetObject,
    ambiguities,
    errors,
    confidence,
    requiredMode: match.definition.requiredMode,
    speakerVerification: {
      required: settings.requireVerifiedSpeaker,
      accepted: speakerAccepted(input, settings),
      decision: input.speakerVerification?.decision ?? null,
      score: input.speakerVerification?.score ?? null,
    },
    recovery: recoveryForStatus(status, ambiguities),
    accessibilityAnnouncement: announcementForResult(
      status,
      match.definition,
      primaryObject,
    ),
    diagnostics: {
      locale: settings.locale,
      grammarEnabled: settings.enabled,
      parserVersion: ECHO_MAGIC_COMMAND_GRAMMAR_VERSION,
      directBattlefieldMutation: false,
    },
  };
}

function createTerminalResult(input: {
  input: EchoMagicCommandGrammarInput;
  timestamp: string;
  settings: EchoMagicCommandGrammarSettings;
  status: "disabled" | "rejected" | "incomplete";
  message: string;
  level: AmbientConfidenceLevel;
  speakerAccepted: boolean;
}): EchoMagicCommandGrammarResult {
  const originalPhrase = sanitizePhrase(input.input.transcript);
  const normalizedPhrase = normalizePhrase(originalPhrase);
  const confidence = createCommandConfidence({
    timestamp: input.timestamp,
    level: input.level,
    score: null,
    reasons: [input.message],
    warningCount: 1,
  });
  return {
    version: ECHO_MAGIC_COMMAND_GRAMMAR_VERSION,
    resultId: makeId("magic-command"),
    status: input.status,
    action: null,
    intentKind: null,
    intent: null,
    originalPhrase,
    normalizedPhrase,
    interpretedPhrase: normalizedPhrase,
    quantity: null,
    primaryObject: null,
    secondaryObject: null,
    targetObject: null,
    ambiguities: [],
    errors: [input.message],
    confidence,
    requiredMode: null,
    speakerVerification: {
      required: input.settings.requireVerifiedSpeaker,
      accepted: input.speakerAccepted,
      decision: input.input.speakerVerification?.decision ?? null,
      score: input.input.speakerVerification?.score ?? null,
    },
    recovery: {
      correctionTypes:
        input.status === "rejected" ? ["not-me", "retry"] : ["retry"],
      message: input.message,
    },
    accessibilityAnnouncement: input.message,
    diagnostics: {
      locale: input.settings.locale,
      grammarEnabled: input.settings.enabled,
      parserVersion: ECHO_MAGIC_COMMAND_GRAMMAR_VERSION,
      directBattlefieldMutation: false,
    },
  };
}

function buildUnknownCommandResult(input: {
  input: EchoMagicCommandGrammarInput;
  timestamp: string;
  settings: EchoMagicCommandGrammarSettings;
  originalPhrase: string;
  normalizedPhrase: string;
}): EchoMagicCommandGrammarResult {
  const message = "Magic command grammar could not identify a gameplay action.";
  const confidence = createCommandConfidence({
    timestamp: input.timestamp,
    level: "unknown",
    score: null,
    reasons: [message],
    warningCount: 1,
  });
  return {
    version: ECHO_MAGIC_COMMAND_GRAMMAR_VERSION,
    resultId: makeId("magic-command"),
    status: "unknown",
    action: null,
    intentKind: null,
    intent: null,
    originalPhrase: input.originalPhrase,
    normalizedPhrase: input.normalizedPhrase,
    interpretedPhrase: input.normalizedPhrase,
    quantity: null,
    primaryObject: null,
    secondaryObject: null,
    targetObject: null,
    ambiguities: [{ type: "unsupported-mechanic", message, candidates: [] }],
    errors: [message],
    confidence,
    requiredMode: null,
    speakerVerification: {
      required: input.settings.requireVerifiedSpeaker,
      accepted: speakerAccepted(input.input, input.settings),
      decision: input.input.speakerVerification?.decision ?? null,
      score: input.input.speakerVerification?.score ?? null,
    },
    recovery: {
      correctionTypes: ["ignore-phrase", "retry"],
      message,
    },
    accessibilityAnnouncement: message,
    diagnostics: {
      locale: input.settings.locale,
      grammarEnabled: input.settings.enabled,
      parserVersion: ECHO_MAGIC_COMMAND_GRAMMAR_VERSION,
      directBattlefieldMutation: false,
    },
  };
}

function definition(
  action: EchoMagicCommandAction,
  intentKind: AmbientIntentKind,
  aliases: string[],
  overrides: Partial<
    Omit<CommandDefinition, "action" | "intentKind" | "aliases">
  > = {},
): CommandDefinition {
  return {
    action,
    intentKind,
    aliases: aliases.map(normalizePhrase),
    requiresObject: false,
    defaultQuantity: null,
    requiredMode: null,
    expectedObjectKinds: [],
    ...overrides,
  };
}

function matchCommandDefinition(
  phrase: string,
  field: GrammarField,
): {
  definition: CommandDefinition;
  alias: string;
  remainder: string;
  interpretedPhrase: string;
  inferredFromContext: boolean;
} | null {
  const bare = bareContextualCommand(phrase, field.ambient.currentMode);
  if (bare) return bare;
  for (const definition of SORTED_DEFINITIONS) {
    for (const alias of definition.aliases) {
      if (phrase === alias || phrase.startsWith(`${alias} `)) {
        return {
          definition: resolveContextualDefinition(
            definition,
            phrase.slice(alias.length).trim(),
          ),
          alias,
          remainder: phrase.slice(alias.length).trim(),
          interpretedPhrase: phrase,
          inferredFromContext: false,
        };
      }
    }
  }
  return null;
}

function resolveContextualDefinition(
  definition: CommandDefinition,
  remainder: string,
): CommandDefinition {
  if (definition.action === "add-counter" && looksLikeManaText(remainder)) {
    return {
      ...definition,
      action: "add-mana",
      intentKind: "add-mana",
      defaultQuantity: null,
      expectedObjectKinds: ["mana"],
    };
  }
  if (definition.action !== "play") return definition;
  const object = removeObjectFiller(remainder);
  if (!BASIC_LANDS.has(object)) {
    return {
      ...definition,
      intentKind: "cast-spell",
      requiredMode: null,
      expectedObjectKinds: ["card", "battlefield-object"],
    };
  }
  return definition;
}

function looksLikeManaText(value: string): boolean {
  const normalized = normalizeName(value)
    .replace(/\bmana\b/g, "")
    .trim();
  return (
    normalizeName(value).includes("mana") ||
    normalized.split(/\s+/).some((part) => MANA_COLORS.has(part))
  );
}

function bareContextualCommand(
  phrase: string,
  mode: AmbientGameplayMode,
): ReturnType<typeof matchCommandDefinition> {
  if (BASIC_LANDS.has(phrase) && isPreparationOrActiveMode(mode)) {
    const play = COMMAND_DEFINITIONS.find((entry) => entry.action === "play");
    if (!play) return null;
    return {
      definition: play,
      alias: "",
      remainder: phrase,
      interpretedPhrase: `play ${phrase}`,
      inferredFromContext: true,
    };
  }
  return null;
}

function primaryObjectText(
  remainder: string,
  definition: CommandDefinition,
): string {
  if (
    definition.action === "end-turn" ||
    definition.action === "pass-priority"
  ) {
    return "";
  }
  if (definition.action === "create") return normalizeTokenText(remainder);
  if (
    definition.action === "add-counter" ||
    definition.action === "remove-counter"
  ) {
    return firstCounterText(remainder);
  }
  return removeObjectFiller(
    remainder
      .replace(/\bto (my )?(hand|graveyard|exile|library|battlefield)\b/g, "")
      .replace(/\bfrom (my )?(hand|graveyard|exile|library|battlefield)\b/g, "")
      .replace(/\btarget\b/g, ""),
  );
}

function targetObjectText(phrase: string): string {
  const matches = [
    /\b(?:to|onto|on) (.+)$/u.exec(phrase),
    /\btarget(?:ing)? (.+)$/u.exec(phrase),
    /\bfrom (.+)$/u.exec(phrase),
    /\bwith (.+)$/u.exec(phrase),
  ].filter(Boolean) as RegExpExecArray[];
  if (!matches.length) return "";
  return removeObjectFiller(matches[0][1] ?? "");
}

function secondaryObjectForCommand(input: {
  phrase: string;
  field: GrammarField;
  action: EchoMagicCommandAction;
  primaryText: string;
  targetText: string;
}): EchoMagicCommandObject | null {
  if (
    input.action !== "block" &&
    input.action !== "attach" &&
    input.action !== "equip"
  ) {
    return null;
  }
  const withMatch = /\bwith (.+)$/u.exec(input.phrase);
  const toMatch = /\b(?:to|onto) (.+)$/u.exec(input.phrase);
  const text = withMatch?.[1] ?? toMatch?.[1] ?? "";
  const cleaned = removeObjectFiller(text);
  if (
    !cleaned ||
    cleaned === input.primaryText ||
    cleaned === input.targetText
  ) {
    return null;
  }
  return resolveCommandObject({
    text: cleaned,
    field: input.field,
    action: input.action,
    expectedKinds: ["battlefield-object", "commander"],
  });
}

function counterObjectForCommand(
  phrase: string,
  field: GrammarField,
  timestamp: string,
): EchoMagicCommandObject {
  void field;
  void timestamp;
  const counter = firstCounterText(phrase);
  const normalized = normalizePhrase(counter);
  const label = COUNTER_ALIASES.get(normalized) ?? counter;
  const match: EchoMagicCommandObjectMatch | null = label
    ? {
        kind: "counter",
        label,
        normalizedLabel: normalizePhrase(label),
        confidence: 1,
        entity: { kind: "counter", name: label, role: "counter" },
        payload: { counterName: label },
      }
    : null;
  return {
    kind: "counter",
    text: counter,
    normalizedText: normalized,
    quantity: null,
    matches: match ? [match] : [],
    selectedMatch: match,
    ambiguous: false,
    missing: !match,
  };
}

function resolveCommandObject(input: {
  text: string;
  field: GrammarField;
  action: EchoMagicCommandAction;
  expectedKinds: EchoMagicCommandObjectKind[];
}): EchoMagicCommandObject {
  const text = removeObjectFiller(input.text);
  const normalizedText = normalizeName(text);
  if (!normalizedText) {
    return createMissingObject(text);
  }
  const candidates = [
    ...landMatches(normalizedText),
    ...counterMatches(normalizedText),
    ...playerMatches(normalizedText),
    ...zoneMatches(normalizedText),
    ...manaMatches(normalizedText),
    ...commanderMatches(normalizedText, input.field),
    ...battlefieldMatches(normalizedText, input.field),
    ...recentCardMatches(normalizedText, input.field),
    ...tokenMatches(normalizedText, input.field, input.action),
  ];
  const expected = input.expectedKinds.length
    ? candidates.filter((candidate) =>
        input.expectedKinds.includes(candidate.kind),
      )
    : candidates;
  const matches = chooseBestMatches(expected.length ? expected : candidates);
  return {
    kind: matches[0]?.kind ?? "unknown",
    text,
    normalizedText,
    quantity: extractQuantity(text),
    matches,
    selectedMatch: matches.length === 1 ? matches[0] : null,
    ambiguous: matches.length > 1,
    missing: matches.length === 0,
  };
}

function createMissingObject(text: string): EchoMagicCommandObject {
  return {
    kind: "unknown",
    text,
    normalizedText: normalizeName(text),
    quantity: extractQuantity(text),
    matches: [],
    selectedMatch: null,
    ambiguous: false,
    missing: true,
  };
}

function landMatches(text: string): EchoMagicCommandObjectMatch[] {
  if (!BASIC_LANDS.has(text)) return [];
  const label = titleCase(text);
  return [
    {
      kind: "land",
      label,
      normalizedLabel: text,
      confidence: 1,
      entity: null,
      payload: { landName: label, cardName: label },
    },
  ];
}

function counterMatches(text: string): EchoMagicCommandObjectMatch[] {
  const label = COUNTER_ALIASES.get(text);
  return label
    ? [
        {
          kind: "counter",
          label,
          normalizedLabel: normalizeName(label),
          confidence: 1,
          entity: { kind: "counter", name: label, role: "counter" },
          payload: { counterName: label },
        },
      ]
    : [];
}

function playerMatches(text: string): EchoMagicCommandObjectMatch[] {
  const owner = PLAYER_ALIASES.get(text);
  return owner
    ? [
        {
          kind: "player",
          label: owner === "you" ? "You" : "Opponent",
          normalizedLabel: text,
          confidence: 1,
          entity: { kind: "player", owner, role: "target" },
          payload: { player: owner },
        },
      ]
    : [];
}

function zoneMatches(text: string): EchoMagicCommandObjectMatch[] {
  const zone = ZONE_ALIASES.get(text);
  return zone
    ? [
        {
          kind: "zone",
          label: zone,
          normalizedLabel: text,
          confidence: 1,
          entity: { kind: "zone", zone: zone as Zone, role: "destination" },
          payload: { zone },
        },
      ]
    : [];
}

function manaMatches(text: string): EchoMagicCommandObjectMatch[] {
  const colorKey = text
    .replace(/\bmana\b/g, "")
    .split(/\s+/)
    .find((part) => MANA_COLORS.has(part));
  const color = colorKey ? MANA_COLORS.get(colorKey) : null;
  return color
    ? [
        {
          kind: "mana",
          label: colorKey ?? text,
          normalizedLabel: colorKey ?? text,
          confidence: 1,
          entity: null,
          payload: { manaColor: color },
        },
      ]
    : [];
}

function commanderMatches(
  text: string,
  field: GrammarField,
): EchoMagicCommandObjectMatch[] {
  if (text !== "commander") return [];
  return field.groups
    .filter(
      (group) =>
        group.characteristics.isLegendary && group.characteristics.isCreature,
    )
    .map((group) => groupMatch(group, "commander", 0.96));
}

function battlefieldMatches(
  text: string,
  field: GrammarField,
): EchoMagicCommandObjectMatch[] {
  const matches: EchoMagicCommandObjectMatch[] = [];
  for (const group of field.groups) {
    const labels = [group.label, group.identity?.name ?? ""]
      .map(normalizeName)
      .filter(Boolean);
    const exact = labels.some((label) => label === text);
    const contains =
      text.length >= 4 &&
      labels.some((label) => label.includes(text) || text.includes(label));
    if (exact || contains) {
      matches.push(groupMatch(group, "battlefield-object", exact ? 1 : 0.74));
    }
  }
  return matches;
}

function recentCardMatches(
  text: string,
  field: GrammarField,
): EchoMagicCommandObjectMatch[] {
  return field.recentCards
    .filter((card) => normalizeName(card.name) === text)
    .map((card) => ({
      kind: "card",
      label: card.name,
      normalizedLabel: text,
      confidence: 0.88,
      entity: null,
      payload: { cardId: card.cardId, cardName: card.name },
    }));
}

function tokenMatches(
  text: string,
  field: GrammarField,
  action: EchoMagicCommandAction,
): EchoMagicCommandObjectMatch[] {
  const normalized = text.replace(/\btokens?\b/g, "").trim();
  if (!normalized && action !== "create") return [];
  const battlefieldTokens = field.groups
    .filter((group) => group.characteristics.isToken)
    .filter((group) => {
      const labels = [
        group.label,
        group.identity?.name ?? "",
        ...group.characteristics.subtypes,
      ].map(normalizeName);
      return labels.some(
        (label) => label === normalized || label.includes(normalized),
      );
    })
    .map((group) => groupMatch(group, "token", 0.84));
  if (battlefieldTokens.length) return battlefieldTokens;
  if (action === "create" && normalized) {
    return [
      {
        kind: "token",
        label: titleCase(normalized),
        normalizedLabel: normalized,
        confidence: 0.82,
        entity: null,
        payload: {
          tokenName: titleCase(normalized),
          tokenSubtype: titleCase(normalized),
        },
      },
    ];
  }
  return [];
}

function groupMatch(
  group: GrammarField["groups"][number],
  kind: EchoMagicCommandObjectKind,
  confidence: number,
): EchoMagicCommandObjectMatch {
  return {
    kind,
    label: group.label,
    normalizedLabel: normalizeName(group.label),
    confidence,
    entity: { kind: "group", id: group.id, role: "target" },
    payload: {
      groupId: group.id,
      objectIds: (group.session?.objectIds ?? [group.id]).join(","),
      quantity: group.quantity,
    },
  };
}

function chooseBestMatches(
  candidates: EchoMagicCommandObjectMatch[],
): EchoMagicCommandObjectMatch[] {
  if (!candidates.length) return [];
  const deduped = new Map<string, EchoMagicCommandObjectMatch>();
  for (const candidate of candidates) {
    const key =
      candidate.entity && "id" in candidate.entity
        ? `${candidate.kind}:${candidate.entity.id}`
        : `${candidate.kind}:${candidate.normalizedLabel}`;
    const existing = deduped.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      deduped.set(key, candidate);
    }
  }
  const sorted = [...deduped.values()].sort(
    (left, right) => right.confidence - left.confidence,
  );
  const best = sorted[0]?.confidence ?? 0;
  return sorted.filter((entry) => entry.confidence >= best - 0.05);
}

function collectAmbiguities(input: {
  definition: CommandDefinition;
  normalizedPhrase: string;
  primaryObject: EchoMagicCommandObject | null;
  secondaryObject: EchoMagicCommandObject | null;
  targetObject: EchoMagicCommandObject | null;
  quantity: number | null;
  mode: AmbientGameplayMode;
}): EchoMagicCommandAmbiguity[] {
  const ambiguities: EchoMagicCommandAmbiguity[] = [];
  const object = input.primaryObject;
  if (input.definition.requiresObject && (!object || object.missing)) {
    ambiguities.push({
      type: "missing-object",
      message: `${actionLabel(input.definition.action)} needs a recognizable object.`,
      candidates: [],
    });
  }
  if (
    (input.definition.action === "add-counter" ||
      input.definition.action === "remove-counter") &&
    (!input.targetObject || input.targetObject.missing)
  ) {
    ambiguities.push({
      type: "missing-object",
      message: `${actionLabel(input.definition.action)} needs a target permanent or player.`,
      candidates: [],
    });
  }
  for (const candidate of [object, input.secondaryObject, input.targetObject]) {
    if (candidate?.ambiguous) {
      ambiguities.push({
        type: "multiple-objects",
        message: `${candidate.text} matches multiple battlefield objects.`,
        candidates: candidate.matches.map((match) => match.label),
      });
    }
  }
  if (
    input.definition.action === "create" &&
    /\btokens\b/u.test(input.normalizedPhrase) &&
    input.quantity === null
  ) {
    ambiguities.push({
      type: "missing-quantity",
      message: "Token creation needs a quantity.",
      candidates: [],
    });
  }
  if (
    input.definition.requiredMode &&
    input.definition.requiredMode !== input.mode
  ) {
    ambiguities.push({
      type: "context-dependent",
      message: `${actionLabel(input.definition.action)} was recognized outside ${input.definition.requiredMode} mode.`,
      candidates: [input.mode, input.definition.requiredMode],
    });
  }
  return ambiguities;
}

function statusForCommand(
  definition: CommandDefinition,
  primaryObject: EchoMagicCommandObject | null,
  ambiguities: EchoMagicCommandAmbiguity[],
): EchoMagicCommandGrammarResult["status"] {
  if (ambiguities.some((entry) => entry.type === "multiple-objects")) {
    return "ambiguous";
  }
  if (
    definition.requiresObject &&
    (!primaryObject || primaryObject.missing) &&
    definition.action !== "cast" &&
    definition.action !== "counter-spell"
  ) {
    return "incomplete";
  }
  if (ambiguities.length) return "ambiguous";
  return "recognized";
}

function confidenceLevelForCommand(input: {
  status: EchoMagicCommandGrammarResult["status"];
  matchInferredFromContext: boolean;
  ambiguities: EchoMagicCommandAmbiguity[];
  speakerVerification: EchoMagicCommandGrammarInput["speakerVerification"];
}): AmbientConfidenceLevel {
  if (input.status === "recognized") {
    return input.matchInferredFromContext ? "medium" : "high";
  }
  if (input.status === "ambiguous") return "low";
  if (input.status === "incomplete") return "low";
  return "unknown";
}

function createIntent(input: {
  definition: CommandDefinition;
  timestamp: string;
  originalPhrase: string;
  normalizedPhrase: string;
  interpretedPhrase: string;
  primaryObject: EchoMagicCommandObject | null;
  secondaryObject: EchoMagicCommandObject | null;
  targetObject: EchoMagicCommandObject | null;
  quantity: number | null;
  confidence: AmbientConfidenceAssessment;
  ambiguities: EchoMagicCommandAmbiguity[];
  status: EchoMagicCommandGrammarResult["status"];
}): AmbientIntentInput {
  const entities = collectIntentEntities(
    input.primaryObject,
    input.secondaryObject,
    input.targetObject,
  );
  return {
    id: makeId("voice-intent"),
    kind: input.definition.intentKind,
    source: "voice-command",
    actor: "you",
    createdAt: input.timestamp,
    entities,
    confidence: input.confidence,
    requiredMode: input.definition.requiredMode,
    requiresPreview:
      input.status !== "recognized" || input.confidence.level !== "high",
    payload: cleanPayload({
      grammarVersion: ECHO_MAGIC_COMMAND_GRAMMAR_VERSION,
      action: input.definition.action,
      originalPhrase: input.originalPhrase,
      normalizedPhrase: input.normalizedPhrase,
      interpretedPhrase: input.interpretedPhrase,
      primaryObjectText: input.primaryObject?.text ?? null,
      secondaryObjectText: input.secondaryObject?.text ?? null,
      targetObjectText: input.targetObject?.text ?? null,
      quantity: input.quantity,
      amount: input.quantity,
      grammarStatus: input.status,
      ambiguityCount: input.ambiguities.length,
      directBattlefieldMutation: false,
      ...payloadFromObject("primary", input.primaryObject),
      ...payloadFromObject("secondary", input.secondaryObject),
      ...payloadFromObject("target", input.targetObject),
    }),
  };
}

function collectIntentEntities(
  ...objects: Array<EchoMagicCommandObject | null>
): AmbientEntityReference[] {
  const seen = new Set<string>();
  const entities: AmbientEntityReference[] = [];
  for (const object of objects) {
    const entity = object?.selectedMatch?.entity;
    if (!entity) continue;
    const key = JSON.stringify(entity);
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push(entity);
  }
  return entities;
}

function payloadFromObject(
  prefix: string,
  object: EchoMagicCommandObject | null,
): Record<string, string | number | boolean | null> {
  if (!object) return {};
  const match = object.selectedMatch;
  return cleanPayload({
    [`${prefix}ObjectKind`]: object.kind,
    [`${prefix}ObjectText`]: object.text,
    [`${prefix}ObjectMissing`]: object.missing,
    [`${prefix}ObjectAmbiguous`]: object.ambiguous,
    [`${prefix}ObjectLabel`]: match?.label ?? null,
    ...Object.fromEntries(
      Object.entries(match?.payload ?? {}).map(([key, value]) => [
        `${prefix}${key[0]?.toUpperCase() ?? ""}${key.slice(1)}`,
        value,
      ]),
    ),
  });
}

function createCommandConfidence(input: {
  timestamp: string;
  level: AmbientConfidenceLevel;
  score: number | null;
  reasons: string[];
  warningCount: number;
}): AmbientConfidenceAssessment {
  return normalizeAmbientConfidence(
    {
      level: input.level,
      source: "voice-command",
      assessedAt: input.timestamp,
      score: input.score,
      reasons: input.reasons,
      validation: {
        contextValid: input.level !== "unknown",
        rulesValid: input.level === "high" || input.level === "medium",
        warningCount: input.warningCount,
      },
    },
    {
      source: "voice-command",
      timestamp: input.timestamp,
      contextValid: input.level !== "unknown",
      rulesValid: input.level === "high" || input.level === "medium",
      warningCount: input.warningCount,
    },
  );
}

function confidenceReasons(
  status: EchoMagicCommandGrammarResult["status"],
  definition: CommandDefinition,
  ambiguities: EchoMagicCommandAmbiguity[],
  match: { inferredFromContext: boolean },
): string[] {
  const reasons = [
    `${actionLabel(definition.action)} command recognized by deterministic Magic grammar.`,
  ];
  if (match.inferredFromContext) {
    reasons.push("Command action inferred from Ambient Gameplay mode.");
  }
  for (const ambiguity of ambiguities.slice(0, 3)) {
    reasons.push(ambiguity.message);
  }
  if (status === "recognized") return reasons;
  if (status === "ambiguous")
    return [...reasons, "Ambiguity requires confirmation or correction."];
  if (status === "incomplete")
    return [...reasons, "Command is missing required information."];
  return reasons;
}

function scoreForLevel(
  level: AmbientConfidenceLevel,
  speakerScore: number | null,
): number | null {
  const base =
    level === "high"
      ? 0.9
      : level === "medium"
        ? 0.66
        : level === "low"
          ? 0.32
          : null;
  if (base === null) return null;
  if (speakerScore === null) return base;
  return Math.round(Math.min(base, speakerScore) * 1000) / 1000;
}

function recoveryForStatus(
  status: EchoMagicCommandGrammarResult["status"],
  ambiguities: EchoMagicCommandAmbiguity[],
): EchoMagicCommandGrammarResult["recovery"] {
  if (status === "recognized") {
    return { correctionTypes: [], message: null };
  }
  if (status === "ambiguous") {
    const hasMultiple = ambiguities.some(
      (entry) => entry.type === "multiple-objects",
    );
    return {
      correctionTypes: hasMultiple ? ["wrong-card", "retry"] : ["retry"],
      message: "Magic command needs confirmation or correction before use.",
    };
  }
  if (status === "incomplete") {
    return {
      correctionTypes: ["wrong-card", "wrong-quantity", "retry"],
      message: "Magic command is missing required information.",
    };
  }
  return {
    correctionTypes: ["ignore-phrase", "retry"],
    message: "Magic command was not understood.",
  };
}

function announcementForResult(
  status: EchoMagicCommandGrammarResult["status"],
  definition: CommandDefinition,
  primaryObject: EchoMagicCommandObject | null,
): string {
  if (status === "recognized") {
    return `${actionLabel(definition.action)} command recognized${primaryObject?.selectedMatch?.label ? ` for ${primaryObject.selectedMatch.label}` : ""}.`;
  }
  if (status === "ambiguous") {
    return `${actionLabel(definition.action)} command needs clarification.`;
  }
  if (status === "incomplete") {
    return `${actionLabel(definition.action)} command is missing required information.`;
  }
  return "Magic command was not recognized.";
}

function isPreparationOrActiveMode(mode: AmbientGameplayMode): boolean {
  return mode === "preTurnPreparation" || mode === "activeTurn";
}

function speakerAccepted(
  input: EchoMagicCommandGrammarInput,
  settings: EchoMagicCommandGrammarSettings,
): boolean {
  return (
    !settings.requireVerifiedSpeaker ||
    Boolean(input.speakerVerification?.verified)
  );
}

function sanitizePhrase(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[<>{}`]/g, "")
        .trim()
        .slice(0, 300)
    : "";
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[“”"]/g, "")
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\bi ll\b/g, "i will")
    .replace(/\bill\b/g, "i will")
    .replace(/\bi m\b/g, "i am")
    .replace(/\bim\b/g, "i am")
    .replace(/\bgonna\b/g, "going to")
    .replace(/\bwanna\b/g, "want to")
    .replace(
      /\b(?:i will|i am going to|i am gonna|i want to|lets|please)\b/g,
      " ",
    )
    .replace(/\bi\b/g, " ")
    .replace(/\bmy\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value: string): string {
  return normalizePhrase(value)
    .replace(/[^a-z0-9+/\s-]/g, "")
    .replace(/\b(?:a|an|the|my)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function removeObjectFiller(value: string): string {
  return normalizeName(value)
    .replace(/\b(?:a|an|the|my|target|with|to|onto|on|from|of)\b/g, " ")
    .replace(/\bcards?\b/g, "")
    .replace(/\bcounters?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTokenText(value: string): string {
  return normalizeName(value)
    .replace(/^\d+\s+/, "")
    .replace(
      new RegExp(`\\b(${[...NUMBER_WORDS.keys()].join("|")})\\b`, "gu"),
      " ",
    )
    .replace(/\btokens?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstCounterText(value: string): string {
  const phrase = normalizeName(value);
  for (const [alias, label] of COUNTER_ALIASES) {
    if (phrase.includes(alias)) return label;
  }
  return "";
}

function extractQuantity(value: string): number | null {
  const phrase = normalizePhrase(value).replace(/\+?\d+\/\+?\d+/g, " ");
  const numeric = /\b(\d{1,4})\b/u.exec(phrase);
  if (numeric) return Number(numeric[1]);
  for (const [word, number] of NUMBER_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "u").test(phrase)) return number;
  }
  return null;
}

function cleanPayload(
  payload: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(
        ([, value]) =>
          value === null ||
          ["string", "number", "boolean"].includes(typeof value),
      )
      .map(([key, value]) => [
        key.slice(0, 80),
        typeof value === "string" ? value.slice(0, 240) : value,
      ]),
  ) as Record<string, string | number | boolean | null>;
}

function actionLabel(action: EchoMagicCommandAction): string {
  return action
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
