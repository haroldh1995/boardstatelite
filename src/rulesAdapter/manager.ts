import {
  createUnavailableCapabilities,
  normalizeCapabilities,
} from "./capabilities";
import { isRulesAdapterStatus } from "./status";
import {
  createLiteFieldSnapshot,
  serializeLiteFieldSnapshot,
  snapshotHash,
} from "./serializer";
import type { FieldState, ResolutionResult } from "../domain/types";
import type {
  BoardStateRulesAdapter,
  LiteFieldSnapshot,
  LiteHelperResolver,
  RulesAdapterCapabilityMap,
  RulesAdapterDiagnostics,
  RulesAdapterEvaluationOutcome,
  RulesAdapterStatus,
  RulesAdapterVersionInfo,
} from "./types";
import {
  LITE_APP_VERSION,
  LITE_SNAPSHOT_VERSION,
  MINIMUM_BOARDSTATE_VERSION,
  RULES_ADAPTER_SERIALIZATION_VERSION,
  RULES_ADAPTER_VERSION,
} from "./types";

const DEFAULT_UNAVAILABLE_REASON =
  "BoardState authoritative rules engine is not configured.";

export class RulesAdapterManager {
  private status: RulesAdapterStatus = "unavailable";
  private adapter: BoardStateRulesAdapter | null = null;
  private capabilities: RulesAdapterCapabilityMap =
    createUnavailableCapabilities();
  private diagnostics: RulesAdapterDiagnostics = {
    status: "unavailable",
    capabilities: this.capabilities,
    version: createVersionInfo(),
    lastAttemptedEvaluation: null,
    fallbackReason: null,
    lastAdapterError: null,
    currentEngine: "lite-helper",
  };

  getStatus(): RulesAdapterStatus {
    return this.status;
  }

  getCapabilities(): RulesAdapterCapabilityMap {
    return { ...this.capabilities };
  }

  getDiagnostics(): RulesAdapterDiagnostics {
    return {
      ...this.diagnostics,
      capabilities: { ...this.diagnostics.capabilities },
      version: { ...this.diagnostics.version },
      lastAttemptedEvaluation: this.diagnostics.lastAttemptedEvaluation
        ? { ...this.diagnostics.lastAttemptedEvaluation }
        : null,
    };
  }

  registerAdapter(adapter: BoardStateRulesAdapter | null): void {
    this.adapter = adapter;
    if (!adapter) {
      this.transition("unavailable", DEFAULT_UNAVAILABLE_REASON);
      return;
    }
    this.capabilities = normalizeCapabilities(adapter.getCapabilities());
    this.transition(adapter.status);
  }

  transition(status: RulesAdapterStatus, message?: string): void {
    this.status = status;
    this.diagnostics = {
      ...this.diagnostics,
      status,
      capabilities: this.getCapabilities(),
      fallbackReason:
        status === "connected"
          ? null
          : (message ?? this.diagnostics.fallbackReason),
      lastAdapterError:
        status === "error" ? (message ?? "Adapter error") : null,
      currentEngine:
        status === "error" || status === "unsupportedVersion"
          ? "lite-helper"
          : this.diagnostics.currentEngine,
    };
  }

  negotiateVersion(input: {
    boardStateVersion: string | null;
    adapterVersion?: string;
  }): RulesAdapterStatus {
    const adapterVersion = input.adapterVersion ?? RULES_ADAPTER_VERSION;
    const compatible =
      input.boardStateVersion &&
      compareVersions(input.boardStateVersion, MINIMUM_BOARDSTATE_VERSION) >=
        0 &&
      compareVersions(adapterVersion, RULES_ADAPTER_VERSION) >= 0;
    const status = compatible
      ? this.status === "connected" || this.status === "connecting"
        ? this.status
        : "disconnected"
      : "unsupportedVersion";

    this.diagnostics = {
      ...this.diagnostics,
      version: {
        ...this.diagnostics.version,
        expectedBoardStateVersion: input.boardStateVersion,
        adapterVersion,
      },
    };
    this.transition(
      status,
      status === "unsupportedVersion"
        ? "BoardState authority version is not compatible with this Lite adapter."
        : undefined,
    );
    return status;
  }

  evaluateWithFallback(
    field: FieldState,
    liteHelper: LiteHelperResolver<ResolutionResult>,
  ): ResolutionResult {
    const outcome = this.attemptEvaluation(field);
    if (outcome.kind === "authority-result") {
      this.diagnostics = {
        ...this.diagnostics,
        currentEngine: "boardstate-authority",
        fallbackReason: null,
      };
      return liteHelper();
    }

    this.diagnostics = {
      ...this.diagnostics,
      currentEngine: "lite-helper",
      fallbackReason: outcome.fallbackReason,
    };
    return liteHelper();
  }

  attemptEvaluation(field: FieldState): RulesAdapterEvaluationOutcome {
    let snapshot: LiteFieldSnapshot;
    let serializedSnapshot: string;
    try {
      snapshot = createLiteFieldSnapshot(field);
      serializedSnapshot = serializeLiteFieldSnapshot(snapshot);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Snapshot serialization failed.";
      this.recordAttempt(field, null);
      this.transition("error", message);
      return {
        kind: "fallback",
        result: null,
        fallbackReason: message,
        snapshot: null,
        serializedSnapshot: null,
      };
    }

    this.recordAttempt(field, snapshotHash(serializedSnapshot));

    if (this.status !== "connected" || !this.adapter) {
      return {
        kind: "fallback",
        result: null,
        fallbackReason: this.reasonForUnavailableStatus(),
        snapshot,
        serializedSnapshot,
      };
    }

    if (!this.capabilities.evaluateSnapshot) {
      return {
        kind: "fallback",
        result: null,
        fallbackReason:
          "Connected BoardState adapter does not report snapshot evaluation support.",
        snapshot,
        serializedSnapshot,
      };
    }

    return {
      kind: "fallback",
      result: null,
      fallbackReason:
        "Asynchronous BoardState authority evaluation is not enabled in Lite runtime yet.",
      snapshot,
      serializedSnapshot,
    };
  }

  reset(): void {
    this.status = "unavailable";
    this.adapter = null;
    this.capabilities = createUnavailableCapabilities();
    this.diagnostics = {
      status: "unavailable",
      capabilities: this.capabilities,
      version: createVersionInfo(),
      lastAttemptedEvaluation: null,
      fallbackReason: null,
      lastAdapterError: null,
      currentEngine: "lite-helper",
    };
  }

  private recordAttempt(field: FieldState, hash: string | null): void {
    this.diagnostics = {
      ...this.diagnostics,
      lastAttemptedEvaluation: {
        at: new Date().toISOString(),
        fieldId: field.id,
        snapshotVersion: LITE_SNAPSHOT_VERSION,
        serializationVersion: RULES_ADAPTER_SERIALIZATION_VERSION,
        snapshotHash: hash,
      },
    };
  }

  private reasonForUnavailableStatus(): string {
    if (!isRulesAdapterStatus(this.status)) return DEFAULT_UNAVAILABLE_REASON;
    if (this.status === "unavailable") return DEFAULT_UNAVAILABLE_REASON;
    if (this.status === "disconnected") return "BoardState is not connected.";
    if (this.status === "connecting")
      return "BoardState adapter is connecting.";
    if (this.status === "unsupportedVersion") {
      return "BoardState authority version is unsupported.";
    }
    if (this.status === "error") {
      return this.diagnostics.lastAdapterError ?? "BoardState adapter error.";
    }
    return DEFAULT_UNAVAILABLE_REASON;
  }
}

export const rulesAdapterManager = new RulesAdapterManager();

installRulesAdapterDiagnosticsGlobal(rulesAdapterManager);

export function createVersionInfo(): RulesAdapterVersionInfo {
  return {
    liteVersion: LITE_APP_VERSION,
    adapterVersion: RULES_ADAPTER_VERSION,
    serializationVersion: RULES_ADAPTER_SERIALIZATION_VERSION,
    snapshotVersion: LITE_SNAPSHOT_VERSION,
    minimumBoardStateVersion: MINIMUM_BOARDSTATE_VERSION,
    expectedBoardStateVersion: null,
  };
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part) || 0);
  const rightParts = right.split(".").map((part) => Number(part) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function installRulesAdapterDiagnosticsGlobal(
  manager: RulesAdapterManager,
): void {
  if (typeof globalThis === "undefined") return;
  const target = globalThis as typeof globalThis & {
    __BAORD_STATE_LITE_RULES_ADAPTER__?: {
      getDiagnostics: () => RulesAdapterDiagnostics;
    };
  };
  target.__BAORD_STATE_LITE_RULES_ADAPTER__ = {
    getDiagnostics: () => manager.getDiagnostics(),
  };
}
