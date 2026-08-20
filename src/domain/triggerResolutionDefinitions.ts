import type { AthenaEventCategory } from "../athena/dependencyGraphTypes";

export const ATHENA_TRIGGER_RESOLUTION_DEFINITION_VERSION = 1;

export type AthenaResolutionTarget =
  | "player-controller"
  | "source"
  | "all-controlled-creatures"
  | "selected";

export type AthenaResolutionQuantity =
  | { kind: "fixed-per-trigger"; value: number }
  | { kind: "logical-multiplicity" }
  | { kind: "current-source-counters"; counterType: string }
  | { kind: "current-source-counters-to-add"; counterType: string }
  | { kind: "player-choice"; minimum: number; maximum: number | null };

export interface AthenaResolutionTokenDefinition {
  name: string;
  power: number;
  toughness: number;
  cardTypes: string[];
  subtypes: string[];
  colors: string[];
  tapped: boolean;
  attacking: boolean;
  copySourceWhenLandThresholdAtLeast: number | null;
}

export type AthenaResolutionAction =
  | {
      id: string;
      kind: "gain-life" | "lose-life";
      target: "player-controller";
      quantity: AthenaResolutionQuantity;
      eventCategory: "life-gained" | "life-lost";
    }
  | {
      id: string;
      kind: "add-counter" | "remove-counter";
      target: Exclude<AthenaResolutionTarget, "player-controller">;
      counterType: string;
      quantity: AthenaResolutionQuantity;
      eventCategory: "counter-placed" | "counter-removed";
    }
  | {
      id: string;
      kind: "create-token";
      target: "player-controller";
      quantity: AthenaResolutionQuantity;
      token: AthenaResolutionTokenDefinition;
      eventCategory: "token-created";
    }
  | {
      id: string;
      kind: "opponent-result";
      target: "player-controller";
      quantity: AthenaResolutionQuantity;
      eventCategory: "damage-dealt";
    };

export interface AthenaTriggerResolutionDefinition {
  id: string;
  version: typeof ATHENA_TRIGGER_RESOLUTION_DEFINITION_VERSION;
  labels: string[];
  observedEvents: AthenaEventCategory[];
  mandatory: boolean;
  locallySupported: boolean;
  requiresAuthority: boolean;
  requiresManualResolution: boolean;
  optionalActionIds?: string[];
  actions: AthenaResolutionAction[];
  semanticLabel: string;
}

const DEFINITIONS: AthenaTriggerResolutionDefinition[] = [
  {
    id: "life-on-creature-entry",
    version: ATHENA_TRIGGER_RESOLUTION_DEFINITION_VERSION,
    labels: ["soul warden", "essence warden"],
    observedEvents: ["creature-entered"],
    mandatory: true,
    locallySupported: true,
    requiresAuthority: false,
    requiresManualResolution: false,
    actions: [
      {
        id: "gain-one-life",
        kind: "gain-life",
        target: "player-controller",
        quantity: { kind: "fixed-per-trigger", value: 1 },
        eventCategory: "life-gained",
      },
    ],
    semanticLabel: "Creature-entry life gain",
  },
  {
    id: "souls-attendant",
    version: ATHENA_TRIGGER_RESOLUTION_DEFINITION_VERSION,
    labels: ["soul's attendant"],
    observedEvents: ["creature-entered"],
    mandatory: false,
    locallySupported: true,
    requiresAuthority: false,
    requiresManualResolution: false,
    actions: [
      {
        id: "may-gain-one-life",
        kind: "gain-life",
        target: "player-controller",
        quantity: { kind: "fixed-per-trigger", value: 1 },
        eventCategory: "life-gained",
      },
    ],
    semanticLabel: "Optional creature-entry life gain",
  },
  {
    id: "cathars-crusade",
    version: ATHENA_TRIGGER_RESOLUTION_DEFINITION_VERSION,
    labels: ["cathars' crusade"],
    observedEvents: ["creature-entered"],
    mandatory: true,
    locallySupported: true,
    requiresAuthority: false,
    requiresManualResolution: false,
    actions: [
      {
        id: "counter-each-creature",
        kind: "add-counter",
        target: "all-controlled-creatures",
        counterType: "+1/+1",
        quantity: { kind: "fixed-per-trigger", value: 1 },
        eventCategory: "counter-placed",
      },
    ],
    semanticLabel: "Cathars' Crusade counters",
  },
  {
    id: "anim-pakal",
    version: ATHENA_TRIGGER_RESOLUTION_DEFINITION_VERSION,
    labels: ["anim pakal, thousandth moon", "anim pakal"],
    observedEvents: ["attack-declared"],
    mandatory: true,
    locallySupported: true,
    requiresAuthority: false,
    requiresManualResolution: false,
    actions: [
      {
        id: "add-anim-counter",
        kind: "add-counter",
        target: "source",
        counterType: "+1/+1",
        quantity: { kind: "fixed-per-trigger", value: 1 },
        eventCategory: "counter-placed",
      },
      {
        id: "create-attacking-gnomes",
        kind: "create-token",
        target: "player-controller",
        quantity: {
          kind: "current-source-counters",
          counterType: "+1/+1",
        },
        token: {
          name: "Gnome",
          power: 1,
          toughness: 1,
          cardTypes: ["Artifact", "Creature"],
          subtypes: ["Gnome"],
          colors: [],
          tapped: true,
          attacking: true,
          copySourceWhenLandThresholdAtLeast: null,
        },
        eventCategory: "token-created",
      },
    ],
    semanticLabel: "Anim Pakal attack",
  },
  {
    id: "mossborn-hydra",
    version: ATHENA_TRIGGER_RESOLUTION_DEFINITION_VERSION,
    labels: ["mossborn hydra"],
    observedEvents: ["land-entered"],
    mandatory: true,
    locallySupported: true,
    requiresAuthority: false,
    requiresManualResolution: false,
    actions: [
      {
        id: "double-hydra-counters",
        kind: "add-counter",
        target: "source",
        counterType: "+1/+1",
        quantity: {
          kind: "current-source-counters-to-add",
          counterType: "+1/+1",
        },
        eventCategory: "counter-placed",
      },
    ],
    semanticLabel: "Mossborn Hydra landfall",
  },
  {
    id: "rampaging-baloths",
    version: ATHENA_TRIGGER_RESOLUTION_DEFINITION_VERSION,
    labels: ["rampaging baloths"],
    observedEvents: ["land-entered"],
    mandatory: true,
    locallySupported: true,
    requiresAuthority: false,
    requiresManualResolution: false,
    actions: [
      {
        id: "create-beast",
        kind: "create-token",
        target: "player-controller",
        quantity: { kind: "fixed-per-trigger", value: 1 },
        token: {
          name: "Beast",
          power: 4,
          toughness: 4,
          cardTypes: ["Creature"],
          subtypes: ["Beast"],
          colors: ["G"],
          tapped: false,
          attacking: false,
          copySourceWhenLandThresholdAtLeast: null,
        },
        eventCategory: "token-created",
      },
    ],
    semanticLabel: "Rampaging Baloths landfall",
  },
  {
    id: "scute-swarm",
    version: ATHENA_TRIGGER_RESOLUTION_DEFINITION_VERSION,
    labels: ["scute swarm"],
    observedEvents: ["land-entered"],
    mandatory: true,
    locallySupported: true,
    requiresAuthority: false,
    requiresManualResolution: false,
    actions: [
      {
        id: "create-insect-or-copy",
        kind: "create-token",
        target: "player-controller",
        quantity: { kind: "fixed-per-trigger", value: 1 },
        token: {
          name: "Insect",
          power: 1,
          toughness: 1,
          cardTypes: ["Creature"],
          subtypes: ["Insect"],
          colors: ["G"],
          tapped: false,
          attacking: false,
          copySourceWhenLandThresholdAtLeast: 6,
        },
        eventCategory: "token-created",
      },
    ],
    semanticLabel: "Scute Swarm landfall",
  },
  {
    id: "impact-tremors",
    version: ATHENA_TRIGGER_RESOLUTION_DEFINITION_VERSION,
    labels: ["impact tremors", "warleader's call"],
    observedEvents: ["creature-entered"],
    mandatory: true,
    locallySupported: false,
    requiresAuthority: false,
    requiresManualResolution: true,
    actions: [
      {
        id: "opponent-damage-report",
        kind: "opponent-result",
        target: "player-controller",
        quantity: { kind: "fixed-per-trigger", value: 1 },
        eventCategory: "damage-dealt",
      },
    ],
    semanticLabel: "Opponent damage",
  },
];

export function getAthenaTriggerResolutionDefinition(
  definitionId: string | null | undefined,
  sourceLabel: string,
): AthenaTriggerResolutionDefinition | null {
  const normalizedId = normalize(definitionId ?? "");
  const normalizedLabel = normalize(sourceLabel);
  const definition = DEFINITIONS.find(
    (entry) =>
      normalize(entry.id) === normalizedId ||
      entry.labels.some(
        (label) =>
          normalizedLabel === normalize(label) ||
          normalizedLabel.includes(normalize(label)),
      ),
  );
  return definition ? copyDefinition(definition) : null;
}

export function getAthenaTriggerResolutionDefinitions(): AthenaTriggerResolutionDefinition[] {
  return DEFINITIONS.map(copyDefinition);
}

function copyDefinition(
  definition: AthenaTriggerResolutionDefinition,
): AthenaTriggerResolutionDefinition {
  return {
    ...definition,
    labels: [...definition.labels],
    observedEvents: [...definition.observedEvents],
    actions: definition.actions.map((action) => ({
      ...action,
      quantity: { ...action.quantity },
      ...(action.kind === "create-token"
        ? {
            token: {
              ...action.token,
              cardTypes: [...action.token.cardTypes],
              subtypes: [...action.token.subtypes],
              colors: [...action.token.colors],
            },
          }
        : {}),
    })) as AthenaResolutionAction[],
  };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9']+/g, "-")
    .replace(/^-+|-+$/g, "");
}
