import type {
  FieldState,
  GameEvent,
  ResolutionResult,
  ResolutionStep,
} from "../domain/types";
import {
  RULES_ADAPTER_VERSION,
  type BoardStateRulesEvaluation,
  type RulesChangeRecord,
} from "../rulesAdapter/types";
import { makeId } from "../domain/cards";
import {
  RULES_RESULT_SCHEMA_VERSION,
  type CanonicalRulesResult,
  type RulesResultChange,
} from "./types";

export function canonicalizeLiteHelperResult(
  before: FieldState,
  helperResult: ResolutionResult,
  timestamp = new Date().toISOString(),
): CanonicalRulesResult {
  const changes = [
    ...changesFromLife(before, helperResult.field),
    ...changesFromCounters(before, helperResult.field),
    ...changesFromEvents(helperResult.events),
  ];
  return {
    id: makeId("rules-result"),
    schemaVersion: RULES_RESULT_SCHEMA_VERSION,
    fieldId: before.id,
    sessionId: before.session.id,
    source: "lite-helper",
    authority: {
      source: "lite-helper",
      label: "Local Helper Engine",
      rulesVersion: null,
      adapterVersion: RULES_ADAPTER_VERSION,
      sessionAuthority: before.session.currentRulesAuthority,
    },
    title: helperResult.title,
    summary: [...helperResult.summary],
    details: [...helperResult.details],
    events: [...helperResult.events],
    changes,
    changedGroupIds: [...helperResult.changedGroupIds],
    warnings: [],
    messages: [],
    unsupportedInteractions: [],
    judgeNotes: [],
    replayMarkers: [],
    loopDetected: helperResult.loopDetected,
    createdAt: timestamp,
    finalField: helperResult.field,
  };
}

export function canonicalizeBoardStateEvaluation(
  before: FieldState,
  evaluation: BoardStateRulesEvaluation,
  timestamp = new Date().toISOString(),
): CanonicalRulesResult {
  const details = [
    ...stepsWithPrefix("Trigger", evaluation.triggerList),
    ...stepsWithPrefix("Replacement effect", evaluation.replacementEffects),
    ...stepsWithPrefix("Static recalculation", evaluation.staticRecalculations),
  ];
  const changes = [
    ...evaluation.battlefieldChanges,
    ...evaluation.lifeChanges,
    ...evaluation.counterChanges,
    ...evaluation.tokenChanges,
    ...evaluation.attachments,
    ...evaluation.zoneChanges,
  ].flatMap(changeFromAdapterRecord);
  const summary = [
    ...evaluation.messages,
    ...evaluation.warnings.map((warning) => `Warning: ${warning}`),
    ...evaluation.unsupportedInteractions.map(
      (entry) => `Unsupported: ${entry}`,
    ),
  ].slice(0, 6);

  return {
    id: makeId("rules-result"),
    schemaVersion: RULES_RESULT_SCHEMA_VERSION,
    fieldId: before.id,
    sessionId: before.session.id,
    source: "boardstate-authority",
    authority: {
      source: "boardstate-authority",
      label: "BoardState Authority",
      rulesVersion: evaluation.rulesVersion,
      adapterVersion: RULES_ADAPTER_VERSION,
      sessionAuthority: "boardstate-authority",
    },
    title: evaluation.ok ? "Rules Result" : "Rules Review Needed",
    summary:
      summary.length > 0
        ? summary
        : ["BoardState returned a rules result with no visible changes."],
    details,
    events: [...evaluation.events],
    changes,
    changedGroupIds: changedGroupIdsFromChanges(changes),
    warnings: [...evaluation.warnings],
    messages: [...evaluation.messages],
    unsupportedInteractions: [...evaluation.unsupportedInteractions],
    judgeNotes: [],
    replayMarkers: [],
    loopDetected: false,
    createdAt: timestamp,
  };
}

function stepsWithPrefix(
  prefix: string,
  steps: ResolutionStep[],
): ResolutionStep[] {
  return steps.map((entry) => ({
    ...entry,
    label: entry.label.startsWith(prefix)
      ? entry.label
      : `${prefix}: ${entry.label}`,
  }));
}

function changesFromLife(
  before: FieldState,
  after: FieldState,
): RulesResultChange[] {
  const delta = after.player.life - before.player.life;
  if (delta === 0) return [];
  return [
    {
      kind: "life",
      player: "you",
      mode: delta > 0 ? "gain" : "loss",
      amount: Math.abs(delta),
      nextValue: after.player.life,
    },
  ];
}

function changesFromCounters(
  before: FieldState,
  after: FieldState,
): RulesResultChange[] {
  const changes: RulesResultChange[] = [];
  for (const afterGroup of after.groups) {
    const beforeGroup = before.groups.find(
      (group) => group.id === afterGroup.id,
    );
    if (!beforeGroup) continue;
    const names = new Set([
      ...Object.keys(beforeGroup.counters),
      ...Object.keys(afterGroup.counters),
    ]);
    for (const counter of names) {
      const delta =
        (afterGroup.counters[counter] ?? 0) -
        (beforeGroup.counters[counter] ?? 0);
      if (delta === 0) continue;
      changes.push({
        kind: "counter",
        target: { groupId: afterGroup.id },
        counter,
        mode: delta > 0 ? "add" : "remove",
        amount: Math.abs(delta),
      });
    }
  }
  return changes;
}

function changesFromEvents(events: GameEvent[]): RulesResultChange[] {
  return events.flatMap((event): RulesResultChange[] => {
    if (event.type === "token-created") {
      return [
        {
          kind: "token",
          mode: "created",
          target: event.groupIds[0]
            ? { groupId: event.groupIds[0] }
            : undefined,
          name: String(event.metadata.name ?? "Token"),
          quantity: event.quantity,
        } satisfies RulesResultChange,
      ];
    }
    if (event.type === "life-gained" || event.type === "life-lost") {
      return [
        {
          kind: "life",
          player: "you",
          mode: event.type === "life-gained" ? "gain" : "loss",
          amount: event.quantity,
        } satisfies RulesResultChange,
      ];
    }
    return [];
  });
}

function changeFromAdapterRecord(
  change: RulesChangeRecord,
): RulesResultChange[] {
  if (change.kind === "life") {
    return [
      {
        kind: "life",
        player: change.player,
        mode: change.mode,
        amount: change.amount,
      },
    ];
  }
  if (change.kind === "counter") {
    return [
      {
        kind: "counter",
        target: { groupId: change.groupId },
        counter: change.counter,
        mode:
          change.mode === "placed"
            ? "add"
            : change.mode === "removed"
              ? "remove"
              : "set",
        amount: change.amount,
      },
    ];
  }
  if (change.kind === "token") {
    return [
      {
        kind: "token",
        target: change.groupId ? { groupId: change.groupId } : undefined,
        mode: change.mode,
        name: change.name,
        quantity: change.quantity,
      },
    ];
  }
  if (change.kind === "zone") {
    return [
      {
        kind: "zone",
        target: { groupId: change.groupId },
        from: change.from,
        to: change.to,
        quantity: change.quantity,
      },
    ];
  }
  if (change.kind === "attachment") {
    return [
      {
        kind: "attachment",
        attachment: { groupId: change.attachmentId },
        host: change.hostId ? { groupId: change.hostId } : null,
        mode: change.mode,
      },
    ];
  }
  if (change.kind === "battlefield") {
    return [
      {
        kind: "permanent",
        mode: "removed",
        target: { groupId: change.groupId },
        label: change.message,
        quantity: 1,
      },
    ];
  }
  return [];
}

function changedGroupIdsFromChanges(changes: RulesResultChange[]): string[] {
  return [
    ...new Set(
      changes.flatMap((change) => {
        if ("target" in change && change.target?.groupId) {
          return [change.target.groupId];
        }
        if (change.kind === "attachment") {
          return [change.attachment.groupId, change.host?.groupId].filter(
            (entry): entry is string => Boolean(entry),
          );
        }
        return [];
      }),
    ),
  ];
}
