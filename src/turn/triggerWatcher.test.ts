import { describe, expect, it } from "vitest";
import { createDefaultTurnContext, resolveTriggerMemory } from "./turnContext";
import { watchTriggerCandidates } from "./triggerWatcher";

describe("trigger watchers", () => {
  const candidate = {
    id: "trigger-1",
    sourceId: "source-1",
    sourceLabel: "Source Card",
    label: "Creature entered",
    optional: true,
    oncePerTurnKey: "source-1:first-entry",
    status: "pending" as const,
    observedAt: "2026-01-01T00:00:00.000Z",
    public: true,
  };

  it("records a structured candidate without duplicating once-per-turn memory", () => {
    const first = watchTriggerCandidates(createDefaultTurnContext(), [
      candidate,
    ]);
    const duplicate = watchTriggerCandidates(first, [
      { ...candidate, id: "trigger-2" },
    ]);
    expect(duplicate.triggerMemory).toHaveLength(1);
  });

  it("does not reopen a trigger the player already accounted for", () => {
    const watched = watchTriggerCandidates(createDefaultTurnContext(), [
      candidate,
    ]);
    const resolved = resolveTriggerMemory(watched, candidate.id, "resolved");
    const replayed = watchTriggerCandidates(resolved, [candidate]);
    expect(replayed.triggerMemory[0].status).toBe("resolved");
  });
});
