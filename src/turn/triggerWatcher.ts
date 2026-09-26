import { enqueueTriggerMemory, resolveTriggerMemory } from "./turnContext";
import type { TriggerMemoryStatus, TurnContextState } from "./types";

export interface TriggerWatcherCandidate {
  id: string;
  sourceId: string | null;
  sourceLabel: string;
  label: string;
  optional: boolean;
  oncePerTurnKey: string | null;
  status: TriggerMemoryStatus;
  observedAt: string;
  public: boolean;
}

export function watchTriggerCandidates(
  state: TurnContextState,
  candidates: TriggerWatcherCandidate[],
): TurnContextState {
  return candidates.reduce((current, candidate) => {
    const existing = current.triggerMemory.find(
      (entry) => entry.id === candidate.id,
    );
    if (
      existing &&
      ["resolved", "declined", "possible-missed"].includes(existing.status) &&
      candidate.status === "pending"
    ) {
      return current;
    }
    const next = enqueueTriggerMemory(current, candidate);
    return candidate.status === "pending"
      ? next
      : resolveTriggerMemory(next, candidate.id, candidate.status);
  }, state);
}
