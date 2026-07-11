import type { LiteFieldSnapshot } from "../rulesAdapter/types";
import type { SharedSessionSnapshot } from "../sharedSession/types";

export const GAME_MODE_VERSION = 1;
export const MODE_HANDOFF_KIND = "baord-state-lite-mode-handoff";
export const MODE_HANDOFF_VERSION = 1;
export const MODE_COMPATIBILITY_VERSION = "0.1.0";

export type GameplayMode = "simple" | "advanced";

export type ModeAvailability = "available" | "unavailable";

export type ModeCapability =
  | "lifeTracker"
  | "battlefield"
  | "counters"
  | "tokens"
  | "helperEngine"
  | "localPersistence"
  | "fullRulesAuthority"
  | "multiplayerAuthority"
  | "replay"
  | "judgeTools"
  | "dryRun"
  | "simulations";

export type ModeCapabilityMap = Record<ModeCapability, boolean>;

export type ModeCompatibilityStatus =
  | "compatible"
  | "incompatible"
  | "unsupportedVersion"
  | "notReady";

export type SessionLockState =
  | "unlocked"
  | "preparingTransfer"
  | "transferred"
  | "returned";

export type LaunchTarget = "boardstate-advanced" | "hub" | "local-lite";

export interface ModeDescriptor {
  mode: GameplayMode;
  label: string;
  availability: ModeAvailability;
  unavailableReason: string | null;
  capabilities: ModeCapabilityMap;
}

export interface ModeCompatibilityMetadata {
  status: ModeCompatibilityStatus;
  checkedAt: string;
  sessionVersion: number;
  rulesAdapterVersion: string;
  serializationVersion: number;
  snapshotVersion: number;
  authorityVersion: string | null;
  liteAppVersion: string;
  compatibilityVersion: string;
  reasons: string[];
}

export interface ModeHandoffState {
  lockState: SessionLockState;
  preparedAt: string | null;
  transferredAt: string | null;
  returnedAt: string | null;
  lastTarget: LaunchTarget | null;
  lastError: string | null;
  readyForFutureHandoff: boolean;
}

export interface ModeReturnState {
  lastReturnAt: string | null;
  lastSource: "boardstate-advanced" | null;
  lastError: string | null;
}

export interface ModeState {
  version: number;
  currentMode: GameplayMode;
  simple: ModeDescriptor;
  advanced: ModeDescriptor;
  compatibility: ModeCompatibilityMetadata;
  handoff: ModeHandoffState;
  return: ModeReturnState;
  updatedAt: string;
}

export interface ModeSnapshot {
  currentMode: GameplayMode;
  availableModes: Record<GameplayMode, ModeAvailability>;
  simple: ModeDescriptor;
  advanced: ModeDescriptor;
  compatibility: ModeCompatibilityMetadata;
  handoff: ModeHandoffState;
}

export interface ModeDiagnostics {
  currentMode: GameplayMode;
  availableModes: Record<GameplayMode, ModeAvailability>;
  unavailableReason: string | null;
  authorityOwner: "local-lite" | "boardstate-advanced" | "unknown";
  compatibility: ModeCompatibilityMetadata;
  sessionReady: boolean;
  futureHandoffReady: boolean;
  lockState: SessionLockState;
  lastError: string | null;
}

export interface CanonicalHandoffSnapshot {
  kind: typeof MODE_HANDOFF_KIND;
  version: number;
  createdAt: string;
  mode: ModeSnapshot;
  session: SharedSessionSnapshot;
  liteSnapshot: LiteFieldSnapshot;
  compatibility: ModeCompatibilityMetadata;
  authority: {
    current: "local-lite";
    requested: "boardstate-advanced";
    transferSupported: false;
  };
  lockState: SessionLockState;
  notes: string[];
}

export interface ModeCompatibilityResult {
  ok: boolean;
  compatibility: ModeCompatibilityMetadata;
  reasons: string[];
}

export interface ModeHandoffResult {
  ok: false;
  status: "advancedUnavailable" | "validationFailed";
  reason: string;
  compatibility: ModeCompatibilityResult;
  snapshot: CanonicalHandoffSnapshot | null;
}

export interface ModeReturnResult {
  ok: false;
  status: "returnUnavailable" | "validationFailed";
  reason: string;
}

export interface LaunchResult {
  ok: false;
  target: LaunchTarget;
  reason: string;
}
