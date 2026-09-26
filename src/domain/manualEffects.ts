import { makeId } from "./cards";
import {
  ATHENA_STATIC_DEFINITION_VERSION,
  type AthenaStaticEffectDefinition,
  type AthenaStaticTargetFilter,
} from "./staticEffects";
import type { FieldState, PermanentGroup } from "./types";

export const MANUAL_EFFECT_STATE_VERSION = 1;

export type EffectSourceKind =
  | "permanent"
  | "card"
  | "emblem"
  | "dungeon-room"
  | "plane"
  | "phenomenon"
  | "scheme"
  | "ongoing-scheme"
  | "global-game-state"
  | "custom-table-effect";

export interface EffectSourceReference {
  kind: EffectSourceKind;
  id: string | null;
  label: string;
  controller: "you" | "opponent" | "shared";
}

export type ManualEffectTarget =
  | "controlled-creatures"
  | "other-controlled-creatures"
  | "tokens"
  | "nontoken-creatures"
  | "creature-type"
  | "selected-creature";

export type ManualEffectModification =
  | { kind: "power-toughness"; power: number; toughness: number }
  | { kind: "grant-keyword"; keyword: string }
  | { kind: "remove-keyword"; keyword: string };

export interface ManualStaticEffect {
  id: string;
  name: string;
  enabled: boolean;
  source: EffectSourceReference;
  target: ManualEffectTarget;
  targetGroupId: string | null;
  subtype: string | null;
  color: string | null;
  modification: ManualEffectModification;
  duration: "while-source-active" | "until-end-of-turn" | "until-removed";
  origin: "athena-automatic" | "user-tools-manual" | "argus-assisted";
  visibility: "public" | "private";
  createdAt: string;
}

export interface ManualEffectState {
  version: typeof MANUAL_EFFECT_STATE_VERSION;
  effects: ManualStaticEffect[];
}

export interface ManualEffectInput {
  name?: string;
  source: EffectSourceReference;
  target: ManualEffectTarget;
  targetGroupId?: string | null;
  subtype?: string | null;
  color?: string | null;
  modification: ManualEffectModification;
  duration?: ManualStaticEffect["duration"];
  visibility?: ManualStaticEffect["visibility"];
}

export function createDefaultManualEffectState(): ManualEffectState {
  return { version: MANUAL_EFFECT_STATE_VERSION, effects: [] };
}

export function normalizeManualEffectState(value: unknown): ManualEffectState {
  if (!value || typeof value !== "object")
    return createDefaultManualEffectState();
  const candidate = value as Partial<ManualEffectState>;
  return {
    version: MANUAL_EFFECT_STATE_VERSION,
    effects: Array.isArray(candidate.effects)
      ? candidate.effects.filter(isManualStaticEffect).slice(-100)
      : [],
  };
}

export function createManualStaticEffect(
  input: ManualEffectInput,
  timestamp = new Date().toISOString(),
): ManualStaticEffect {
  return {
    id: makeId("manual-effect"),
    name: input.name?.trim() || describeModification(input.modification),
    enabled: true,
    source: { ...input.source },
    target: input.target,
    targetGroupId: input.targetGroupId ?? null,
    subtype: input.subtype?.trim() || null,
    color: input.color?.trim() || null,
    modification: { ...input.modification },
    duration: input.duration ?? "while-source-active",
    origin: "user-tools-manual",
    visibility: input.visibility ?? "public",
    createdAt: timestamp,
  };
}

export function activeManualStaticDefinitions(
  field: FieldState,
): AthenaStaticEffectDefinition[] {
  return field.manualEffects.effects
    .filter(
      (effect) =>
        effect.enabled &&
        effect.modification.kind === "power-toughness" &&
        effect.source.kind === "permanent" &&
        Boolean(effect.source.id) &&
        field.groups.some(
          (group) =>
            group.id === effect.source.id &&
            group.zone === "battlefield" &&
            group.trackingEnabled !== false,
        ),
    )
    .map((effect) => toStaticDefinition(effect));
}

export function applyManualPowerToughnessEffects(
  field: FieldState,
): FieldState {
  const effects = field.manualEffects.effects.filter(
    (effect) =>
      effect.enabled &&
      effect.modification.kind === "power-toughness" &&
      sourceIsActive(field, effect.source),
  );
  if (effects.length === 0) return field;
  return {
    ...field,
    groups: field.groups.map((group) => {
      const applicable = effects.filter((effect) =>
        effectAppliesToGroup(field, effect, group),
      );
      if (applicable.length === 0) return group;
      const delta = applicable.reduce(
        (total, effect) => ({
          power:
            total.power +
            (effect.modification.kind === "power-toughness"
              ? effect.modification.power
              : 0),
          toughness:
            total.toughness +
            (effect.modification.kind === "power-toughness"
              ? effect.modification.toughness
              : 0),
        }),
        { power: 0, toughness: 0 },
      );
      return {
        ...group,
        pt: {
          ...group.pt,
          currentPower:
            group.pt.currentPower === null
              ? null
              : group.pt.currentPower + delta.power,
          currentToughness:
            group.pt.currentToughness === null
              ? null
              : group.pt.currentToughness + delta.toughness,
        },
      };
    }),
  };
}

export function manualPowerToughnessContributions(
  field: FieldState,
  group: PermanentGroup,
): ManualStaticEffect[] {
  return field.manualEffects.effects.filter(
    (effect) =>
      effect.enabled &&
      effect.modification.kind === "power-toughness" &&
      effectAppliesToGroup(field, effect, group),
  );
}

export function manualKeywordState(
  field: FieldState,
  group: PermanentGroup,
): { granted: string[]; removed: string[] } {
  const granted = new Set<string>();
  const removed = new Set<string>();
  for (const effect of field.manualEffects.effects) {
    if (!effect.enabled || !effectAppliesToGroup(field, effect, group))
      continue;
    if (effect.modification.kind === "grant-keyword") {
      granted.add(effect.modification.keyword);
      removed.delete(effect.modification.keyword);
    }
    if (effect.modification.kind === "remove-keyword") {
      removed.add(effect.modification.keyword);
      granted.delete(effect.modification.keyword);
    }
  }
  return { granted: [...granted].sort(), removed: [...removed].sort() };
}

export function effectAppliesToGroup(
  field: FieldState,
  effect: ManualStaticEffect,
  group: PermanentGroup,
): boolean {
  if (group.zone !== "battlefield" || !group.characteristics.isCreature)
    return false;
  if (!sourceIsActive(field, effect.source)) return false;
  if (effect.target === "selected-creature")
    return group.id === effect.targetGroupId;
  if (
    effect.target === "other-controlled-creatures" &&
    group.id === effect.source.id
  )
    return false;
  if (effect.target === "tokens") return group.characteristics.isToken;
  if (effect.target === "nontoken-creatures")
    return !group.characteristics.isToken;
  if (effect.target === "creature-type") {
    return Boolean(
      effect.subtype &&
      group.characteristics.subtypes.some(
        (entry) => entry.toLowerCase() === effect.subtype?.toLowerCase(),
      ),
    );
  }
  return true;
}

export function sourceIsActive(
  field: FieldState,
  source: EffectSourceReference,
): boolean {
  if (source.kind === "custom-table-effect") return true;
  if (source.kind === "global-game-state") return true;
  if (source.kind === "permanent" || source.kind === "card") {
    return field.groups.some(
      (group) =>
        group.id === source.id &&
        group.zone === "battlefield" &&
        group.trackingEnabled !== false,
    );
  }
  return field.externalGameState.sources.some(
    (entry) => entry.id === source.id && entry.active,
  );
}

export function effectsProvidedBySource(
  state: ManualEffectState,
  sourceId: string,
): ManualStaticEffect[] {
  return state.effects.filter(
    (effect) => effect.enabled && effect.source.id === sourceId,
  );
}

function toStaticDefinition(
  effect: ManualStaticEffect,
): AthenaStaticEffectDefinition {
  const modification = effect.modification;
  if (modification.kind !== "power-toughness") {
    throw new Error("Only power/toughness effects become static definitions.");
  }
  return {
    version: ATHENA_STATIC_DEFINITION_VERSION,
    id: effect.id,
    abilityId: `manual:${effect.id}`,
    cardNames: [],
    sourceGroupIds: effect.source.id ? [effect.source.id] : [],
    category: "continuous-effect",
    operation: "add",
    target: staticTarget(effect),
    power: { fixed: modification.power, terms: [] },
    toughness: { fixed: modification.toughness, terms: [] },
    reads: [],
    dependsOnDefinitionIds: [],
    support: "fully-automated",
  };
}

function staticTarget(effect: ManualStaticEffect): AthenaStaticTargetFilter {
  return {
    kind:
      effect.target === "other-controlled-creatures"
        ? "other-controlled-creatures"
        : effect.target === "selected-creature"
          ? "selected"
          : "controlled-creatures",
    selectedGroupId: effect.targetGroupId,
    tokenState:
      effect.target === "tokens"
        ? "token"
        : effect.target === "nontoken-creatures"
          ? "nontoken"
          : "any",
    cardType: "Creature",
    subtype: effect.target === "creature-type" ? effect.subtype : null,
    color: effect.color,
  };
}

function describeModification(modification: ManualEffectModification): string {
  if (modification.kind === "grant-keyword")
    return `Grant ${modification.keyword}`;
  if (modification.kind === "remove-keyword")
    return `Remove ${modification.keyword}`;
  const power =
    modification.power >= 0
      ? `+${modification.power}`
      : `${modification.power}`;
  const toughness =
    modification.toughness >= 0
      ? `+${modification.toughness}`
      : `${modification.toughness}`;
  return `Creatures get ${power}/${toughness}`;
}

function isManualStaticEffect(value: unknown): value is ManualStaticEffect {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as ManualStaticEffect).id === "string" &&
    typeof (value as ManualStaticEffect).source?.kind === "string" &&
    typeof (value as ManualStaticEffect).modification?.kind === "string",
  );
}
