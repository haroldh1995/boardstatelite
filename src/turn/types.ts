export const TURN_CONTEXT_VERSION = 1;

export type TurnQuickPhase =
  | "beginning"
  | "precombat-main"
  | "combat"
  | "postcombat-main"
  | "ending";

export type TurnStep =
  | "untap"
  | "upkeep"
  | "draw"
  | "precombat-main"
  | "begin-combat"
  | "declare-attackers"
  | "declare-blockers"
  | "combat-damage"
  | "end-combat"
  | "postcombat-main"
  | "end-step"
  | "cleanup";

export type TriggerMemoryStatus =
  | "pending"
  | "resolved"
  | "declined"
  | "possible-missed";

export interface TriggerMemoryItem {
  id: string;
  sourceId: string | null;
  sourceLabel: string;
  label: string;
  optional: boolean;
  oncePerTurnKey: string | null;
  status: TriggerMemoryStatus;
  observedAt: string;
  resolvedAt: string | null;
  public: boolean;
}

export interface TurnContextState {
  version: typeof TURN_CONTEXT_VERSION;
  status: "between-turns" | "active";
  turnId: string;
  turnNumber: number;
  quickPhase: TurnQuickPhase;
  step: TurnStep;
  startedAt: string | null;
  endedAt: string | null;
  phaseChangedAt: string;
  combatAccounted: boolean;
  triggerMemory: TriggerMemoryItem[];
  archivedTriggerCount: number;
  oncePerTurnKeys: string[];
  dismissedReminderKeys: string[];
}

export interface TurnMemorySummary {
  pending: number;
  possibleMissed: number;
  resolved: number;
  declined: number;
  compactLabel: string;
  complete: boolean;
}
