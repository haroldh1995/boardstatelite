import { makeId, splitGroupForQuantity } from "../domain/cards";
import type { AbilityMetadata } from "../domain/abilityMetadata";
import type { FieldState, GameEvent } from "../domain/types";
import type { TriggerMemoryItem } from "../turn/types";
import { buildAthenaDecisionCandidates } from "./decisionEngine";
import {
  compileAbilityCosts,
  compileAbilityInstructions,
} from "./abilityInstructions";
import type {
  AbilityChoice,
  AbilityInstruction,
  AbilityWorkflow,
} from "./abilityWorkflowTypes";
import {
  createAthenaForecastInput,
  createForecastEnvironment,
} from "./eventForecast";
import { createAthenaPendingTriggerQueue } from "./triggerQueue";
import { processAthenaConfirmedEventWithBookkeeping } from "./triggerResolution";
import type { AthenaForecastInputDraft } from "./eventForecastTypes";
import { getAthenaTriggerResolutionDefinition } from "../domain/triggerResolutionDefinitions";
import { abilitySelector } from "./abilityInstructions";
import { watchTriggerCandidates } from "../turn";

export function prepareAbility(
  field: FieldState,
  sourceId: string,
  ability: AbilityMetadata,
): TriggerMemoryItem {
  const source = field.groups.find((group) => group.id === sourceId)!;
  return {
    id: makeId("ability"),
    sourceId,
    sourceLabel: source.label,
    label: ability.text,
    optional: false,
    oncePerTurnKey: null,
    status: "pending",
    public: true,
    observedAt: new Date().toISOString(),
    resolvedAt: null,
    workflow: {
      version: 1,
      sourceId,
      sourceLabel: source.label,
      ability,
      stage: ability.kind === "activated" ? "selection" : "resolution",
      choices: {},
      costsCommitted: false,
      committedEventIds: [],
    },
  };
}

export function workflowInstructions(workflow: AbilityWorkflow) {
  const replaceSource = (text: string) =>
    text
      .split(workflow.sourceLabel)
      .join("this permanent")
      .split(workflow.sourceLabel.split(",")[0])
      .join("this permanent");
  if (workflow.stage === "selection")
    return compileAbilityCosts(replaceSource(workflow.ability.cost));
  // Preserve the existing verified sequential Anim Pakal definition, including X after counters.
  const known =
    workflow.ability.kind === "triggered"
      ? getAthenaTriggerResolutionDefinition(null, workflow.sourceLabel)
      : null;
  if (
    known?.id === "anim-pakal" &&
    /non-Gnome|attacking/i.test(workflow.ability.text)
  ) {
    const instructions: AbilityInstruction[] = known.actions.flatMap(
      (action): AbilityInstruction[] => {
        if (action.kind === "add-counter")
          return [
            {
              kind: "event",
              text: "Put a +1/+1 counter on this permanent",
              selector: abilitySelector("source")!,
              draft: {
                eventCategory: "counter-placed",
                counterType: action.counterType,
                quantity: 1,
              },
            },
          ];
        if (action.kind === "create-token")
          return [
            {
              kind: "event",
              text: "Create tapped and attacking Gnomes",
              quantitySourceCounters: "+1/+1",
              draft: {
                eventCategory: "token-created",
                quantity: 1,
                tokenDefinition: {
                  id: "anim-pakal-gnome",
                  name: action.token.name,
                  power: action.token.power,
                  toughness: action.token.toughness,
                  characteristics: {
                    cardTypes: action.token.cardTypes,
                    subtypes: action.token.subtypes,
                    colors: action.token.colors,
                    supertypes: [],
                    manaValue: 0,
                    isToken: true,
                    isCreature: true,
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
                metadata: { tapped: true, attacking: true },
              },
            },
          ];
        return [];
      },
    );
    return instructions;
  }
  return compileAbilityInstructions(replaceSource(workflow.ability.effect));
}

export function abilityCandidates(
  field: FieldState,
  sourceId: string,
  instruction: AbilityInstruction,
) {
  if (instruction.kind !== "event" || !instruction.selector) return [];
  if (instruction.selector.source)
    return field.groups.filter(
      (group) => group.id === sourceId && group.zone === "battlefield",
    );
  const ids = new Set(
    buildAthenaDecisionCandidates(field, instruction.selector.constraints, {
      sourceGroupId: sourceId,
    }).map((candidate) => candidate.groupId),
  );
  return field.groups
    .filter((group) => ids.has(group.id))
    .filter(
      (group) =>
        !/\blegendary\b/i.test(instruction.text) ||
        group.characteristics.isLegendary,
    )
    .filter(
      (group) =>
        !/\buntapped\b/i.test(instruction.text) || !group.statuses.tapped,
    )
    .filter(
      (group) => !/\btapped\b/i.test(instruction.text) || group.statuses.tapped,
    )
    .filter(
      (group) =>
        instruction.draft.eventCategory !== "counter-removed" ||
        !instruction.draft.counterType ||
        (group.counters[instruction.draft.counterType] ?? 0) >=
          (instruction.draft.quantity ?? 1),
    );
}

export interface WorkflowRequirement {
  key: string;
  instruction: AbilityInstruction;
  candidates: ReturnType<typeof abilityCandidates>;
  reason: string;
}

function flatten(
  instructions: AbilityInstruction[],
  choices: Record<string, AbilityChoice>,
  prefix: string,
): Array<{ key: string; instruction: AbilityInstruction }> {
  return instructions.flatMap((instruction, index) => {
    const key = `${prefix}.${index}`;
    const choice = choices[key];
    if (instruction.kind === "optional" && choice?.accepted !== undefined)
      return choice.accepted
        ? flatten(instruction.instructions, choices, key)
        : [];
    if (
      instruction.kind === "modes" &&
      choice?.modes?.length === instruction.count &&
      new Set(choice.modes).size === instruction.count &&
      choice.modes.every((mode) => instruction.modes[mode])
    )
      return choice.modes.flatMap((mode) =>
        flatten(
          instruction.modes[mode].instructions,
          choices,
          `${key}.mode${mode}`,
        ),
      );
    return [{ key, instruction }];
  });
}

export function workflowRequirements(
  field: FieldState,
  workflow: AbilityWorkflow,
  targetOnly = false,
): WorkflowRequirement[] {
  const prefix = targetOnly ? "targets" : workflow.stage;
  const instructions = targetOnly
    ? workflowInstructions({ ...workflow, stage: "resolution" })
    : workflowInstructions(workflow);
  return flatten(instructions, workflow.choices, prefix).flatMap(
    ({ key, instruction }) => {
      const choice = workflow.choices[key];
      const candidates = abilityCandidates(
        field,
        workflow.sourceId,
        instruction,
      );
      const missing = (reason: string) => [
        { key, instruction, candidates, reason },
      ];
      if (
        targetOnly &&
        instruction.kind !== "modes" &&
        !(instruction.kind === "event" && instruction.selector?.targeting)
      )
        return [];
      if (instruction.kind === "manual")
        return missing(
          "Resolve at the table; no automatic result will be invented.",
        );
      if (instruction.kind === "payment")
        return choice?.accepted === true ? [] : missing(instruction.text);
      if (instruction.kind === "optional" || instruction.kind === "modes")
        return missing(instruction.text);
      if (instruction.kind !== "event") return [];
      const selector = instruction.selector;
      if (!selector) return [];
      if (choice?.external?.trim())
        return targetOnly
          ? []
          : missing(
              "External choice recorded. Resolve its consequences at the table.",
            );
      if (
        !instruction.draft.counterType &&
        /counter/.test(instruction.draft.eventCategory ?? "") &&
        !choice?.counterType
      )
        return missing("Select the counter type.");
      if (selector.source || selector.all) {
        if (selector.source && candidates.length === 0)
          return missing(
            "The source or its tracked cost is unavailable. Correct it or record the action at the table.",
          );
        return [];
      }
      const ids = choice?.ids;
      if (
        !ids ||
        ids.length < selector.minimum ||
        ids.length > selector.maximum ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !candidates.some((group) => group.id === id))
      )
        return missing(
          selector.targeting ? "Select targets." : "Choose the permanent.",
        );
      if (
        instruction.distribution &&
        (Object.values(choice?.distribution ?? {}).reduce(
          (sum, value) => sum + value,
          0,
        ) !== instruction.distribution ||
          ids.some(
            (id) =>
              !Number.isSafeInteger(choice?.distribution?.[id]) ||
              (choice?.distribution?.[id] ?? 0) < 1,
          ))
      )
        return missing(
          `Distribute exactly ${instruction.distribution} counters, at least one to each selected target.`,
        );
      return [];
    },
  );
}

export function replaceWorkflow(
  field: FieldState,
  id: string,
  workflow: AbilityWorkflow,
): FieldState {
  const terminal = ["resolved", "cancelled", "manual"].includes(workflow.stage);
  return {
    ...field,
    turnContext: {
      ...field.turnContext,
      triggerMemory: field.turnContext.triggerMemory.map((item) =>
        item.id === id
          ? {
              ...item,
              workflow,
              status: terminal
                ? workflow.stage === "cancelled"
                  ? "declined"
                  : "resolved"
                : "pending",
              resolvedAt: terminal ? new Date().toISOString() : null,
            }
          : item,
      ),
    },
  };
}

/** Both entry modes converge here; the existing Athena committer owns every consequence. */
export function advanceAbilityWorkflow(
  field: FieldState,
  id: string,
): { field: FieldState; events: GameEvent[]; error: string | null } {
  const item = field.turnContext.triggerMemory.find((entry) => entry.id === id);
  const workflow = item?.workflow;
  const fail = (error: string) => ({ field, events: [], error });
  if (!workflow || !["selection", "resolution"].includes(workflow.stage))
    return fail("This action is already complete.");
  const requirements = workflowRequirements(field, workflow);
  if (workflow.stage === "selection")
    requirements.push(...workflowRequirements(field, workflow, true));
  if (requirements.length) return fail(requirements[0].reason);
  let working = field;
  let sourceId = workflow.sourceId;
  if (workflow.stage === "selection") {
    const source = field.groups.find(
      (group) => group.id === sourceId && group.zone === "battlefield",
    );
    if (!source)
      return fail(
        "Source no longer present. Record the action at the table or correct the battlefield.",
      );
    const split = splitGroupForQuantity(field.groups, sourceId, 1);
    sourceId = split.targetId!;
    working = {
      ...working,
      groups: split.groups.map((group) =>
        group.id === sourceId
          ? { ...group, abilityInstanceId: sourceId }
          : group,
      ),
    };
  }
  const timestamp = new Date().toISOString();
  const queue = createAthenaPendingTriggerQueue({
    canonicalSessionId: field.session.id,
    participantId: field.multiplayer.registry.localParticipantId,
    timestamp,
  });
  const events: GameEvent[] = [];
  const instructions = flatten(
    workflowInstructions(workflow),
    workflow.choices,
    workflow.stage,
  );
  for (const { key, instruction } of instructions) {
    if (instruction.kind !== "event") continue;
    const choice = workflow.choices[key] ?? {};
    const selector = instruction.selector;
    const targets = selector
      ? selector.source
        ? [sourceId]
        : selector.all
          ? abilityCandidates(working, sourceId, instruction).map(
              (group) => group.id,
            )
          : (choice.ids ?? [])
      : [null];
    for (const target of targets) {
      const group = working.groups.find((entry) => entry.id === target);
      if (
        target &&
        (!group ||
          !(selector?.constraints.zones ?? ["battlefield"]).includes(
            group.zone,
          ))
      )
        return fail(
          "A selected object changed. Review the action before continuing.",
        );
      const amount = instruction.quantitySourceCounters
        ? (working.groups.find((entry) => entry.id === sourceId)?.counters[
            instruction.quantitySourceCounters
          ] ?? 0)
        : instruction.distribution && target
          ? choice.distribution![target]
          : (instruction.draft.quantity ?? 1);
      if (amount === 0) continue;
      const counterType = instruction.draft.counterType ?? choice.counterType;
      if (
        instruction.draft.eventCategory === "counter-removed" &&
        group &&
        (group.counters[counterType ?? ""] ?? 0) < amount
      )
        return fail(
          "Tracked counters are insufficient. Correct the counter state first.",
        );
      const eventId = `${id}:${key}:${target ?? "player"}`;
      const draft = {
        ...instruction.draft,
        eventId,
        eventCategory: instruction.draft.eventCategory!,
        quantity:
          selector?.all &&
          /permanent-(sacrificed|died|exiled)/.test(
            instruction.draft.eventCategory ?? "",
          )
            ? group!.quantity
            : amount,
        sourceObjectId: sourceId,
        subjectGroupIds: target ? [target] : [],
        counterType,
        knownCharacteristics: group?.characteristics,
        timestamp,
        eventSource: "manual-report",
        authoritySource: "confirmed-user-report",
        confidence: { level: "high", score: 1, speakerVerified: null },
        metadata: {
          ...instruction.draft.metadata,
          confirmed: true,
          canonicalEvent: true,
          hypothetical: false,
          abilityActionId: id,
          targetQuantity: selector?.all ? (group?.quantity ?? 1) : 1,
        },
      } as AthenaForecastInputDraft;
      const result = processAthenaConfirmedEventWithBookkeeping({
        field: working,
        event: createAthenaForecastInput(
          draft,
          createForecastEnvironment(working),
        ),
        queue,
        timestamp,
        deferTriggeredResolution: workflow.stage === "selection",
      });
      if (result.validity !== "committed") return fail(result.reason);
      working = result.resultingField;
      if (result.rootCanonicalEvent) events.push(result.rootCanonicalEvent);
      events.push(...(result.autoResolution?.generatedCanonicalEvents ?? []));
    }
  }
  const activating = workflow.stage === "selection";
  const choices = { ...workflow.choices };
  if (activating)
    for (const [key, value] of Object.entries(choices))
      if (key.startsWith("targets."))
        choices[key.replace(/^targets\./, "resolution.")] = value;
  working = replaceWorkflow(working, id, {
    ...workflow,
    sourceId,
    choices,
    stage: activating ? "resolution" : "resolved",
    costsCommitted: workflow.costsCommitted || activating,
    committedEventIds: [
      ...workflow.committedEventIds,
      ...events.map((event) => event.id),
    ],
  });
  if (activating)
    working = {
      ...working,
      turnContext: {
        ...working.turnContext,
        abilityUses: [
          ...(working.turnContext.abilityUses ?? []),
          {
            sourceId,
            abilityId: workflow.ability.id,
            turnId: field.turnContext.turnId,
            actionId: id,
            loyalty: workflow.ability.loyalty,
          },
        ],
      },
    };
  working = {
    ...working,
    turnContext: watchTriggerCandidates(
      working.turnContext,
      queue.toSnapshot().entries.map((entry) => ({
        id: entry.id,
        sourceId: entry.source.sourceGroupId,
        sourceLabel: entry.source.label,
        label: entry.semanticDescription,
        optional: entry.optional,
        oncePerTurnKey: null,
        status:
          entry.queueState === "resolved"
            ? ("resolved" as const)
            : entry.queueState === "declined"
              ? ("declined" as const)
              : ("pending" as const),
        observedAt: entry.createdAt,
        public: true,
      })),
    ),
  };
  return { field: working, events, error: null };
}
