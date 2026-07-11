import type { FieldState } from "../domain/types";
import { createCanonicalHandoffSnapshot } from "./serializer";
import {
  ADVANCED_UNAVAILABLE_REASON,
  createModeCompatibility,
  normalizeModeState,
} from "./state";
import type {
  CanonicalHandoffSnapshot,
  LaunchResult,
  LaunchTarget,
  ModeCompatibilityResult,
  ModeDiagnostics,
  ModeHandoffResult,
  ModeReturnResult,
  ModeState,
} from "./types";

const RETURN_UNAVAILABLE_REASON =
  "BoardState Advanced return support is unavailable until the Advanced application exists.";
const LAUNCH_UNAVAILABLE_REASON =
  "Application launching is unavailable until a real ecosystem target is configured.";

export class ModeManager {
  private lastError: string | null = null;
  private lastUnavailableReason: string | null = null;
  private lastMode: ModeState | null = null;
  private lastHandoffSnapshot: CanonicalHandoffSnapshot | null = null;

  ensureMode(field: FieldState): ModeState {
    const mode = normalizeModeState(field.mode, {
      fallbackTimestamp: field.updatedAt,
    });
    this.lastMode = mode;
    return mode;
  }

  negotiateCapabilities(field: FieldState): ModeState {
    return this.ensureMode(field);
  }

  validateSessionCompatibility(field: FieldState): ModeCompatibilityResult {
    const mode = this.ensureMode(field);
    const compatibility = createModeCompatibility(field.updatedAt);
    const reasons =
      mode.currentMode === "simple"
        ? []
        : ["Advanced Mode is unavailable in the current Lite runtime."];
    return {
      ok: reasons.length === 0,
      compatibility: {
        ...compatibility,
        status: reasons.length === 0 ? "compatible" : "notReady",
        reasons,
      },
      reasons,
    };
  }

  prepareAdvancedHandoff(field: FieldState): ModeHandoffResult {
    const compatibility = this.validateSessionCompatibility(field);
    if (!compatibility.ok) {
      this.lastError = compatibility.reasons.join(" ");
      return {
        ok: false,
        status: "validationFailed",
        reason: this.lastError,
        compatibility,
        snapshot: null,
      };
    }
    const snapshot = createCanonicalHandoffSnapshot(field);
    this.lastHandoffSnapshot = snapshot;
    this.lastUnavailableReason = ADVANCED_UNAVAILABLE_REASON;
    return {
      ok: false,
      status: "advancedUnavailable",
      reason: ADVANCED_UNAVAILABLE_REASON,
      compatibility,
      snapshot,
    };
  }

  receiveAdvancedReturn(_payload: unknown): ModeReturnResult {
    this.lastUnavailableReason = RETURN_UNAVAILABLE_REASON;
    return {
      ok: false,
      status: "returnUnavailable",
      reason: RETURN_UNAVAILABLE_REASON,
    };
  }

  launch(target: LaunchTarget): LaunchResult {
    this.lastUnavailableReason = LAUNCH_UNAVAILABLE_REASON;
    return {
      ok: false,
      target,
      reason: LAUNCH_UNAVAILABLE_REASON,
    };
  }

  diagnostics(field?: FieldState): ModeDiagnostics | null {
    const mode = field ? this.ensureMode(field) : this.lastMode;
    if (!mode) return null;
    return {
      currentMode: mode.currentMode,
      availableModes: {
        simple: mode.simple.availability,
        advanced: mode.advanced.availability,
      },
      unavailableReason:
        mode.advanced.unavailableReason ?? this.lastUnavailableReason,
      authorityOwner: "local-lite",
      compatibility: mode.compatibility,
      sessionReady: mode.compatibility.status === "compatible",
      futureHandoffReady: mode.handoff.readyForFutureHandoff,
      lockState: mode.handoff.lockState,
      lastError: this.lastError,
    };
  }

  getLastHandoffSnapshot(): CanonicalHandoffSnapshot | null {
    return this.lastHandoffSnapshot;
  }
}

export const modeManager = new ModeManager();

installModeDiagnosticsGlobal();

function installModeDiagnosticsGlobal(): void {
  if (typeof globalThis === "undefined") return;
  const target = globalThis as typeof globalThis & {
    __BAORD_STATE_LITE_MODE_MANAGER__?: {
      getDiagnostics: (field?: FieldState) => ModeDiagnostics | null;
    };
  };
  target.__BAORD_STATE_LITE_MODE_MANAGER__ = {
    getDiagnostics: (field?: FieldState) => modeManager.diagnostics(field),
  };
}
