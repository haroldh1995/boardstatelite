import type { FieldState } from "../domain/types";
import {
  MULTIPLAYER_UNAVAILABLE_REASON,
  createMultiplayerSnapshot,
  normalizeMultiplayerState,
} from "./state";
import type {
  MultiplayerDiagnostics,
  MultiplayerSnapshot,
  MultiplayerState,
  MultiplayerUnavailableResult,
} from "./types";

export class MultiplayerParticipationManager {
  private lastError: string | null = null;
  private lastUnavailableReason: string | null = null;
  private lastState: MultiplayerState | null = null;

  ensureMultiplayer(field: FieldState): MultiplayerState {
    const state = normalizeMultiplayerState(field.multiplayer, {
      session: field.session,
      fallbackTimestamp: field.updatedAt,
      objectIds: field.groups.flatMap(
        (group) => group.session?.objectIds ?? [group.id],
      ),
    });
    this.lastState = state;
    return state;
  }

  snapshot(field: FieldState): MultiplayerSnapshot {
    return createMultiplayerSnapshot(this.ensureMultiplayer(field));
  }

  negotiateCapabilities(field: FieldState): MultiplayerState {
    return this.ensureMultiplayer(field);
  }

  joinSession(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  leaveSession(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  publishBattlefield(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  receiveBattlefield(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  mergeChanges(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  resolveConflict(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  receiveRulesResult(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  publishSnapshot(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  receiveSnapshot(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  reconnect(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  resynchronize(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  heartbeat(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  exchangeCapabilities(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  exchangeVersions(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  discoverApplications(): MultiplayerUnavailableResult {
    return this.unavailable();
  }

  diagnostics(field?: FieldState): MultiplayerDiagnostics | null {
    const state = field ? this.ensureMultiplayer(field) : this.lastState;
    if (!state) return null;
    return {
      status: state.status,
      participantCount: state.registry.participants.length,
      localParticipantId: state.registry.localParticipantId,
      applicationType: state.applicationType,
      authority: { ...state.authority },
      multiplayerAvailable: false,
      synchronizationAvailable: false,
      conflictStrategy: state.conflict.strategy,
      lastUnavailableReason: this.lastUnavailableReason,
      lastError: this.lastError,
    };
  }

  private unavailable(): MultiplayerUnavailableResult {
    this.lastUnavailableReason = MULTIPLAYER_UNAVAILABLE_REASON;
    return {
      ok: false,
      status: "unavailable",
      reason: MULTIPLAYER_UNAVAILABLE_REASON,
    };
  }
}

export const multiplayerParticipationManager =
  new MultiplayerParticipationManager();

installMultiplayerDiagnosticsGlobal();

function installMultiplayerDiagnosticsGlobal(): void {
  if (typeof globalThis === "undefined") return;
  const target = globalThis as typeof globalThis & {
    __BAORD_STATE_LITE_MULTIPLAYER__?: {
      getDiagnostics: (field?: FieldState) => MultiplayerDiagnostics | null;
    };
  };
  target.__BAORD_STATE_LITE_MULTIPLAYER__ = {
    getDiagnostics: (field?: FieldState) =>
      multiplayerParticipationManager.diagnostics(field),
  };
}
