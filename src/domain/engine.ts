import {
  createGenericGroup,
  createTokenGroup,
  makeId,
  mergeCompatibleStacks,
  parseCharacteristics,
  recalculateStats,
  splitGroupForQuantity,
  supportStatusForCard,
  withStackKey,
} from "./cards";
import { calculateTotals, normalizeField } from "./field";
import type {
  CardIdentity,
  CounterApplicationMode,
  FieldState,
  GameEvent,
  PermanentGroup,
  ResolutionResult,
  ResolutionStep,
  StackScope,
} from "./types";

const LOOP_STEP_LIMIT = 200;

export function activateField(field: FieldState): ResolutionResult {
  const working = cloneField(field);
  const details: ResolutionStep[] = [];
  const events: GameEvent[] = [];
  const changedGroupIds = new Set<string>();
  let loopDetected = false;
  let steps = 0;

  const activeAnimGroups = findActiveByName(working, "anim pakal");
  const tokenEntryBatches: { quantity: number; groupIds: string[] }[] = [];

  for (const anim of activeAnimGroups) {
    if (++steps > LOOP_STEP_LIMIT) {
      loopDetected = true;
      break;
    }
    const counterResult = placeCountersInternal(
      working,
      anim.id,
      "+1/+1",
      1,
      "game-action",
    );
    counterResult.changedGroupIds.forEach((id) => changedGroupIds.add(id));
    details.push(
      step(
        "Anim Pakal prepared attackers",
        `${anim.label} received ${counterResult.placedPerObject} +1/+1 counter.`,
      ),
    );
    events.push(
      createEvent("counter-placed", anim.id, 1, [anim.id], {
        counter: "+1/+1",
        amountPerObject: counterResult.placedPerObject,
      }),
    );

    const refreshed = working.groups.find((group) => group.id === anim.id);
    const gnomeCount = (refreshed?.counters["+1/+1"] ?? 0) * anim.quantity;
    if (gnomeCount > 0) {
      const created = createTokensInternal(working, {
        name: "Gnome",
        quantity: gnomeCount,
        power: 1,
        toughness: 1,
        subtypes: ["Gnome"],
        colors: ["R", "W"],
        tapped: true,
        attacking: true,
      });
      tokenEntryBatches.push({
        quantity: created.quantity,
        groupIds: [created.groupId],
      });
      changedGroupIds.add(created.groupId);
      details.push(
        step(
          "Anim Pakal created Gnomes",
          `Created ${created.quantity} tapped and attacking Gnome creature token(s).`,
        ),
      );
      events.push(
        createEvent(
          "token-created",
          anim.id,
          created.quantity,
          [created.groupId],
          { name: "Gnome" },
        ),
      );
      events.push(
        createEvent(
          "creature-entered",
          anim.id,
          created.quantity,
          [created.groupId],
          { simultaneous: true },
        ),
      );
    }
  }

  for (const batch of tokenEntryBatches) {
    resolveCreatureEntered(
      working,
      batch.quantity,
      batch.groupIds,
      details,
      events,
      changedGroupIds,
    );
  }

  applyActivateCustomEffects(working, details, events, changedGroupIds);
  working.groups = mergeCompatibleStacks(working.groups);

  return finalizeResult(field, working, {
    title: loopDetected ? "Repeating interaction detected" : "Field Activated",
    details,
    events,
    changedGroupIds,
    loopDetected,
    fallbackSummary: ["No supported active abilities resolved."],
  });
}

export function resolveLandEntry(
  field: FieldState,
  count: number,
  mode: "one-at-a-time" | "simultaneous" | "correction",
): ResolutionResult {
  const working = cloneField(field);
  const details: ResolutionStep[] = [];
  const events: GameEvent[] = [];
  const changedGroupIds = new Set<string>();
  const normalizedCount = Math.max(0, Math.trunc(count));

  if (normalizedCount === 0) {
    return finalizeResult(field, working, {
      title: "No Land Change",
      details,
      events,
      changedGroupIds,
      loopDetected: false,
      fallbackSummary: ["No land increase was applied."],
    });
  }

  const landGroup = createGenericGroup({
    kind: "Land",
    label: "Generic lands",
    quantity: normalizedCount,
    zone: "battlefield",
  });
  working.groups.push(landGroup);
  changedGroupIds.add(landGroup.id);
  details.push(
    step(
      "Land total increased",
      `${normalizedCount} land(s) were added to the battlefield.`,
    ),
  );

  if (mode === "correction") {
    details.push(
      step(
        "Correction only",
        "No landfall or watched-event triggers were processed.",
      ),
    );
    return finalizeResult(field, working, {
      title: "Land Total Corrected",
      details,
      events,
      changedGroupIds,
      loopDetected: false,
      fallbackSummary: [`Added ${normalizedCount} land(s) as a correction.`],
    });
  }

  const eventsToResolve = mode === "one-at-a-time" ? normalizedCount : 1;
  const quantityPerEvent = mode === "one-at-a-time" ? 1 : normalizedCount;
  for (let index = 0; index < eventsToResolve; index += 1) {
    events.push(
      createEvent(
        "land-entered",
        landGroup.id,
        quantityPerEvent,
        [landGroup.id],
        { mode },
      ),
    );
    resolveLandfall(
      working,
      quantityPerEvent,
      details,
      events,
      changedGroupIds,
    );
  }

  return finalizeResult(field, working, {
    title: "Landfall Resolved",
    details,
    events,
    changedGroupIds,
    loopDetected: false,
    fallbackSummary: [
      `Added ${normalizedCount} land(s) and resolved watched land-entry effects.`,
    ],
  });
}

export function applyCounters(
  field: FieldState,
  groupId: string,
  counter: string,
  amount: number,
  scope: StackScope,
  customQuantity: number,
  mode: CounterApplicationMode,
): ResolutionResult {
  const working = cloneField(field);
  const details: ResolutionStep[] = [];
  const events: GameEvent[] = [];
  const changedGroupIds = new Set<string>();
  const group = working.groups.find((entry) => entry.id === groupId);

  if (!group) {
    return finalizeResult(field, working, {
      title: "Counter Not Applied",
      details,
      events,
      changedGroupIds,
      loopDetected: false,
      fallbackSummary: ["The selected permanent no longer exists."],
    });
  }

  const targetQuantity =
    scope === "one"
      ? 1
      : scope === "custom"
        ? Math.max(1, Math.min(customQuantity, group.quantity))
        : group.quantity;
  const split = splitGroupForQuantity(working.groups, groupId, targetQuantity);
  working.groups = split.groups;
  if (!split.targetId) {
    return finalizeResult(field, working, {
      title: "Counter Not Applied",
      details,
      events,
      changedGroupIds,
      loopDetected: false,
      fallbackSummary: ["The selected permanent could not be split."],
    });
  }
  const result = placeCountersInternal(
    working,
    split.targetId,
    counter,
    amount,
    mode,
  );
  result.changedGroupIds.forEach((id) => changedGroupIds.add(id));
  const target = working.groups.find((entry) => entry.id === split.targetId);
  details.push(
    step(
      mode === "correction"
        ? "Counter correction applied"
        : "Counter game action applied",
      `${target?.label ?? group.label} received ${result.placedPerObject} ${counter} counter(s) per object.`,
    ),
  );
  if (mode === "game-action") {
    events.push(
      createEvent(
        "counter-placed",
        split.targetId,
        target?.quantity ?? targetQuantity,
        [split.targetId],
        {
          counter,
          amountPerObject: result.placedPerObject,
        },
      ),
    );
  }

  return finalizeResult(field, working, {
    title: "Counters Updated",
    details,
    events,
    changedGroupIds,
    loopDetected: false,
    fallbackSummary: [`Applied ${counter} counter(s).`],
  });
}

export function removeGroupQuantity(
  field: FieldState,
  groupId: string,
  quantity: number,
): ResolutionResult {
  const working = cloneField(field);
  const details: ResolutionStep[] = [];
  const events: GameEvent[] = [];
  const changedGroupIds = new Set<string>();
  const group = working.groups.find((entry) => entry.id === groupId);
  if (!group) {
    return finalizeResult(field, working, {
      title: "Nothing Removed",
      details,
      events,
      changedGroupIds,
      loopDetected: false,
      fallbackSummary: ["The selected permanent was already gone."],
    });
  }
  const removed = Math.max(1, Math.min(quantity, group.quantity));
  if (removed >= group.quantity) {
    working.groups = working.groups.filter((entry) => entry.id !== groupId);
  } else {
    working.groups = working.groups.map((entry) =>
      entry.id === groupId
        ? { ...entry, quantity: entry.quantity - removed }
        : entry,
    );
  }
  changedGroupIds.add(groupId);
  details.push(
    step(
      "Permanent removed neutrally",
      `Removed ${removed} ${group.label}. This did not count as dying, sacrifice, exile, bounce, or destruction.`,
    ),
  );
  return finalizeResult(field, working, {
    title: "Permanent Removed",
    details,
    events,
    changedGroupIds,
    loopDetected: false,
    fallbackSummary: [`Removed ${removed} ${group.label}.`],
  });
}

export function replaceGenericIdentity(
  field: FieldState,
  groupId: string,
  card: CardIdentity,
  scope: StackScope,
  customQuantity: number,
): ResolutionResult {
  const working = cloneField(field);
  const details: ResolutionStep[] = [];
  const events: GameEvent[] = [];
  const changedGroupIds = new Set<string>();
  const group = working.groups.find((entry) => entry.id === groupId);
  if (!group || !group.isGeneric) {
    return finalizeResult(field, working, {
      title: "Replacement Not Applied",
      details,
      events,
      changedGroupIds,
      loopDetected: false,
      fallbackSummary: ["Only generic placeholders can be replaced this way."],
    });
  }
  const targetQuantity =
    scope === "one"
      ? 1
      : scope === "custom"
        ? Math.max(1, Math.min(customQuantity, group.quantity))
        : group.quantity;
  const split = splitGroupForQuantity(working.groups, groupId, targetQuantity);
  working.groups = split.groups;
  if (!split.targetId) {
    return finalizeResult(field, working, {
      title: "Replacement Not Applied",
      details,
      events,
      changedGroupIds,
      loopDetected: false,
      fallbackSummary: ["The selected generic stack could not be split."],
    });
  }
  const characteristics = parseCharacteristics(card.typeLine, card);
  working.groups = working.groups.map((entry) => {
    if (entry.id !== split.targetId) return entry;
    return withStackKey(
      recalculateStats({
        ...entry,
        label: card.name,
        identity: {
          ...card,
          supportStatus: supportStatusForCard(card.name, card.oracleText),
        },
        originalIdentity: card,
        originalCharacteristics: characteristics,
        characteristics: {
          ...characteristics,
          isToken: entry.characteristics.isToken,
        },
        isGeneric: false,
        abilitiesActive: true,
        pt: {
          ...entry.pt,
          printedPower: entry.pt.printedPower,
          printedToughness: entry.pt.printedToughness,
        },
      }),
    );
  });
  changedGroupIds.add(split.targetId);
  details.push(
    step(
      "Generic identity replaced",
      `${targetQuantity} placeholder object(s) became ${card.name}. Counters, statuses, attachments, damage, and stack state were preserved.`,
    ),
  );
  return finalizeResult(field, working, {
    title: "Placeholder Replaced",
    details,
    events,
    changedGroupIds,
    loopDetected: false,
    fallbackSummary: [
      `Replaced ${targetQuantity} placeholder object(s) with ${card.name}.`,
    ],
  });
}

export function transformCreatures(
  field: FieldState,
  card: CardIdentity,
  scope: "all" | "nontoken" | "tokens" | "selected",
  selectedIds: string[],
  restoreAbilities: boolean,
): ResolutionResult {
  const working = cloneField(field);
  const details: ResolutionStep[] = [];
  const events: GameEvent[] = [];
  const changedGroupIds = new Set<string>();
  const targetCharacteristics = parseCharacteristics(card.typeLine, card);
  working.groups = working.groups.map((group) => {
    if (group.zone !== "battlefield" || !group.characteristics.isCreature)
      return group;
    if (scope === "nontoken" && group.characteristics.isToken) return group;
    if (scope === "tokens" && !group.characteristics.isToken) return group;
    if (scope === "selected" && !selectedIds.includes(group.id)) return group;

    changedGroupIds.add(group.id);
    return withStackKey(
      recalculateStats({
        ...group,
        label: card.name,
        identity: card,
        originalIdentity: group.originalIdentity ?? group.identity,
        originalCharacteristics:
          group.originalCharacteristics ?? group.characteristics,
        characteristics: {
          ...targetCharacteristics,
          isToken: group.characteristics.isToken,
        },
        abilitiesActive: restoreAbilities ? true : group.abilitiesActive,
        depowerMode: restoreAbilities ? "none" : group.depowerMode,
        statuses: {
          ...group.statuses,
          transformed: true,
          depowered: restoreAbilities ? false : group.statuses.depowered,
        },
        pt: {
          ...group.pt,
          printedPower:
            Number.parseInt(card.power ?? "", 10) || group.pt.printedPower,
          printedToughness:
            Number.parseInt(card.toughness ?? "", 10) ||
            group.pt.printedToughness,
          basePower:
            Number.parseInt(card.power ?? "", 10) || group.pt.basePower,
          baseToughness:
            Number.parseInt(card.toughness ?? "", 10) || group.pt.baseToughness,
        },
      }),
    );
  });
  details.push(
    step(
      "Transform All resolved",
      `${changedGroupIds.size} creature group(s) transformed into ${card.name}. No enter-the-battlefield abilities triggered.`,
    ),
  );
  return finalizeResult(field, working, {
    title: "Creatures Transformed",
    details,
    events,
    changedGroupIds,
    loopDetected: false,
    fallbackSummary: [
      `Transformed ${changedGroupIds.size} creature group(s) into ${card.name}.`,
    ],
  });
}

export function restoreTransformations(field: FieldState): ResolutionResult {
  const working = cloneField(field);
  const details: ResolutionStep[] = [];
  const events: GameEvent[] = [];
  const changedGroupIds = new Set<string>();
  working.groups = working.groups.map((group) => {
    if (
      !group.statuses.transformed ||
      !group.originalIdentity ||
      !group.originalCharacteristics
    )
      return group;
    changedGroupIds.add(group.id);
    return withStackKey(
      recalculateStats({
        ...group,
        label: group.originalIdentity.name,
        identity: group.originalIdentity,
        characteristics: {
          ...group.originalCharacteristics,
          isToken: group.characteristics.isToken,
        },
        statuses: {
          ...group.statuses,
          transformed: false,
        },
      }),
    );
  });
  details.push(
    step(
      "Original forms restored",
      `${changedGroupIds.size} transformed group(s) restored.`,
    ),
  );
  return finalizeResult(field, working, {
    title: "Transformations Restored",
    details,
    events,
    changedGroupIds,
    loopDetected: false,
    fallbackSummary: [`Restored ${changedGroupIds.size} transformed group(s).`],
  });
}

export function setLife(
  field: FieldState,
  nextLife: number,
  mode: "gain" | "loss" | "damage" | "pay" | "set",
): ResolutionResult {
  const working = cloneField(field);
  const details: ResolutionStep[] = [];
  const events: GameEvent[] = [];
  const changedGroupIds = new Set<string>();
  const before = working.player.life;
  working.player.life = Math.max(0, Math.trunc(nextLife));
  const delta = working.player.life - before;
  const eventType = delta >= 0 ? "life-gained" : "life-lost";
  details.push(
    step(
      "Life total changed",
      `Life ${mode}: ${before} to ${working.player.life}.`,
    ),
  );
  if (delta !== 0) {
    events.push(createEvent(eventType, null, Math.abs(delta), [], { mode }));
  }
  return finalizeResult(field, working, {
    title: "Life Updated",
    details,
    events,
    changedGroupIds,
    loopDetected: false,
    fallbackSummary: [`Life changed from ${before} to ${working.player.life}.`],
  });
}

function resolveCreatureEntered(
  field: FieldState,
  quantity: number,
  groupIds: string[],
  details: ResolutionStep[],
  events: GameEvent[],
  changedGroupIds: Set<string>,
): void {
  const crusadeCount = countActiveByName(field, "cathars' crusade");
  if (crusadeCount > 0 && quantity > 0) {
    const triggerCount = crusadeCount * quantity;
    const creatureGroups = field.groups.filter(
      (group) =>
        group.zone === "battlefield" && group.characteristics.isCreature,
    );
    const multiplier = counterReplacementMultiplier(field);
    for (const group of creatureGroups) {
      const result = placeCountersInternal(
        field,
        group.id,
        "+1/+1",
        triggerCount,
        "game-action",
      );
      result.changedGroupIds.forEach((id) => changedGroupIds.add(id));
    }
    details.push(
      step(
        "Cathars' Crusade triggered",
        `Cathars' Crusade triggered ${triggerCount} time(s). Each creature received ${
          triggerCount * multiplier
        } +1/+1 counter(s).`,
      ),
    );
    events.push(
      createEvent(
        "counter-placed",
        null,
        triggerCount,
        creatureGroups.map((group) => group.id),
        {
          source: "Cathars' Crusade",
          amountPerObject: triggerCount * multiplier,
        },
      ),
    );
  }

  const soulWardenCount = countActiveByNames(field, [
    "soul warden",
    "essence warden",
  ]);
  if (soulWardenCount > 0 && quantity > 0) {
    const gained = soulWardenCount * quantity;
    field.player.life += gained;
    details.push(
      step(
        "Life trigger resolved",
        `You gained ${gained} life from creature-entering triggers.`,
      ),
    );
    events.push(
      createEvent("life-gained", null, gained, groupIds, {
        source: "Soul Warden effect",
      }),
    );
  }

  const impactTremorsCount = countActiveByName(field, "impact tremors");
  if (impactTremorsCount > 0 && quantity > 0) {
    details.push(
      step(
        "Opponent damage summarized",
        `Impact Tremors dealt ${impactTremorsCount * quantity} damage to each opponent. Opponent life is not tracked.`,
      ),
    );
    events.push(
      createEvent(
        "damage-dealt",
        null,
        impactTremorsCount * quantity,
        groupIds,
        { opponentOnly: true },
      ),
    );
  }
}

function resolveLandfall(
  field: FieldState,
  landQuantity: number,
  details: ResolutionStep[],
  events: GameEvent[],
  changedGroupIds: Set<string>,
): void {
  const baloths = countActiveByName(field, "rampaging baloths");
  if (baloths > 0) {
    const created = createTokensInternal(field, {
      name: "Beast",
      quantity: baloths * landQuantity,
      power: 4,
      toughness: 4,
      subtypes: ["Beast"],
      colors: ["G"],
    });
    changedGroupIds.add(created.groupId);
    details.push(
      step(
        "Rampaging Baloths landfall",
        `Created ${created.quantity} 4/4 green Beast creature token(s).`,
      ),
    );
    events.push(
      createEvent("token-created", null, created.quantity, [created.groupId], {
        source: "Rampaging Baloths",
      }),
    );
    events.push(
      createEvent(
        "creature-entered",
        null,
        created.quantity,
        [created.groupId],
        { source: "Rampaging Baloths" },
      ),
    );
    resolveCreatureEntered(
      field,
      created.quantity,
      [created.groupId],
      details,
      events,
      changedGroupIds,
    );
  }
}

function applyActivateCustomEffects(
  field: FieldState,
  details: ResolutionStep[],
  events: GameEvent[],
  changedGroupIds: Set<string>,
): void {
  const totals = calculateTotals(field.groups);
  for (const effect of field.customEffects.filter(
    (entry) => entry.enabled && entry.trigger === "activate-field",
  )) {
    const amount = resolveValue(effect.action.amount, field, totals);
    if (effect.action.kind === "add-counters") {
      const targets =
        effect.action.target === "all-creatures"
          ? field.groups.filter(
              (group) =>
                group.zone === "battlefield" &&
                group.characteristics.isCreature,
            )
          : [];
      for (const target of targets) {
        const result = placeCountersInternal(
          field,
          target.id,
          effect.action.counter,
          amount,
          "game-action",
        );
        result.changedGroupIds.forEach((id) => changedGroupIds.add(id));
      }
      details.push(
        step(
          `Custom effect: ${effect.name}`,
          `Added ${amount} ${effect.action.counter} counter(s).`,
        ),
      );
      events.push(
        createEvent(
          "counter-placed",
          null,
          amount,
          targets.map((target) => target.id),
          { custom: true },
        ),
      );
    }
    if (effect.action.kind === "create-token") {
      const created = createTokensInternal(field, {
        name: effect.action.name,
        quantity: amount,
        power: effect.action.power,
        toughness: effect.action.toughness,
        subtypes: effect.action.subtypes,
      });
      changedGroupIds.add(created.groupId);
      details.push(
        step(
          `Custom effect: ${effect.name}`,
          `Created ${created.quantity} ${effect.action.name} token(s).`,
        ),
      );
      events.push(
        createEvent(
          "token-created",
          null,
          created.quantity,
          [created.groupId],
          { custom: true },
        ),
      );
    }
    if (effect.action.kind === "life") {
      const signed = effect.action.mode === "gain" ? amount : -amount;
      field.player.life = Math.max(0, field.player.life + signed);
      details.push(
        step(
          `Custom effect: ${effect.name}`,
          `${effect.action.mode === "gain" ? "Gained" : "Lost"} ${amount} life.`,
        ),
      );
      events.push(
        createEvent(
          effect.action.mode === "gain" ? "life-gained" : "life-lost",
          null,
          amount,
          [],
          { custom: true },
        ),
      );
    }
  }
}

function placeCountersInternal(
  field: FieldState,
  groupId: string,
  counter: string,
  amount: number,
  mode: CounterApplicationMode,
): { placedPerObject: number; changedGroupIds: string[] } {
  const multiplier =
    mode === "game-action" ? counterReplacementMultiplier(field) : 1;
  const placedPerObject = Math.max(0, Math.trunc(amount)) * multiplier;
  const changedGroupIds: string[] = [];
  field.groups = field.groups.map((group) => {
    if (group.id !== groupId) return group;
    changedGroupIds.push(group.id);
    return withStackKey(
      recalculateStats({
        ...group,
        counters: {
          ...group.counters,
          [counter]: (group.counters[counter] ?? 0) + placedPerObject,
        },
      }),
    );
  });
  return { placedPerObject, changedGroupIds };
}

function createTokensInternal(
  field: FieldState,
  input: {
    name: string;
    quantity: number;
    power: number;
    toughness: number;
    subtypes: string[];
    colors?: string[];
    tapped?: boolean;
    attacking?: boolean;
  },
): { quantity: number; groupId: string } {
  const multiplier = tokenReplacementMultiplier(field);
  const quantity = Math.max(0, Math.trunc(input.quantity)) * multiplier;
  const group = createTokenGroup({ ...input, quantity });
  field.groups.push(group);
  field.groups = mergeCompatibleStacks(field.groups);
  const matching = field.groups.find(
    (entry) => entry.stackKey === group.stackKey,
  );
  return { quantity, groupId: matching?.id ?? group.id };
}

function counterReplacementMultiplier(field: FieldState): number {
  return countActiveByName(field, "doubling season") > 0 ? 2 : 1;
}

function tokenReplacementMultiplier(field: FieldState): number {
  return countActiveByName(field, "doubling season") > 0 ? 2 : 1;
}

function countActiveByName(field: FieldState, nameFragment: string): number {
  return findActiveByName(field, nameFragment).reduce(
    (total, group) => total + group.quantity,
    0,
  );
}

function countActiveByNames(
  field: FieldState,
  nameFragments: string[],
): number {
  return field.groups
    .filter((group) => nameFragments.some((name) => isActiveNamed(group, name)))
    .reduce((total, group) => total + group.quantity, 0);
}

function findActiveByName(
  field: FieldState,
  nameFragment: string,
): PermanentGroup[] {
  return field.groups.filter((group) => isActiveNamed(group, nameFragment));
}

function isActiveNamed(group: PermanentGroup, nameFragment: string): boolean {
  return (
    group.zone === "battlefield" &&
    group.abilitiesActive &&
    group.depowerMode !== "all" &&
    group.depowerMode !== "triggered" &&
    Boolean(group.identity?.name.toLowerCase().includes(nameFragment))
  );
}

function createEvent(
  type: GameEvent["type"],
  sourceId: string | null,
  quantity: number,
  groupIds: string[],
  metadata: Record<string, string | number | boolean>,
): GameEvent {
  return {
    id: makeId("event"),
    type,
    sourceId,
    controller: "you",
    owner: "you",
    quantity,
    batchId: makeId("batch"),
    groupIds,
    metadata,
  };
}

function resolveValue(
  value: { type: string; value?: number; key?: string; counter?: string },
  field: FieldState,
  totals: Record<string, number>,
): number {
  if (value.type === "fixed") return Math.max(0, Math.trunc(value.value ?? 0));
  if (value.type === "total" && value.key) return totals[value.key] ?? 0;
  if (value.type === "counter-total" && value.counter) {
    return field.groups.reduce(
      (sum, group) =>
        sum + (group.counters[value.counter ?? ""] ?? 0) * group.quantity,
      0,
    );
  }
  return 0;
}

function finalizeResult(
  _before: FieldState,
  after: FieldState,
  input: {
    title: string;
    details: ResolutionStep[];
    events: GameEvent[];
    changedGroupIds: Set<string>;
    loopDetected: boolean;
    fallbackSummary: string[];
  },
): ResolutionResult {
  const normalizedAfter = normalizeField(after);
  const summary = summarize(input.details, input.fallbackSummary);
  return {
    field: normalizedAfter,
    title: input.title,
    summary,
    details: input.details,
    events: input.events,
    changedGroupIds: [...input.changedGroupIds],
    loopDetected: input.loopDetected,
  };
}

function summarize(details: ResolutionStep[], fallback: string[]): string[] {
  if (details.length === 0) {
    return fallback;
  }
  return details.slice(0, 6).map((entry) => entry.detail);
}

function step(label: string, detail: string): ResolutionStep {
  return {
    id: makeId("step"),
    label,
    detail,
  };
}

function cloneField(field: FieldState): FieldState {
  return structuredClone(field);
}
