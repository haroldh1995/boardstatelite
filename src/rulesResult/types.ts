import type {
  CounterName,
  FieldState,
  GameEvent,
  Owner,
  ResolutionResult,
  ResolutionStep,
  StatusFlags,
  Zone,
} from "../domain/types";
import type { SessionAuthority } from "../sharedSession/types";

export const RULES_RESULT_SCHEMA_VERSION = 1;
export const RULES_RESULT_RENDERER_VERSION = "0.1.0";

export type RulesResultSource = "lite-helper" | "boardstate-authority";

export type RulesRenderingMode =
  | "instant"
  | "animated"
  | "reduced-motion"
  | "silent"
  | "future-replay";

export type RulesResultValidationStatus = "valid" | "invalid" | "recovered";

export interface RulesResultAuthority {
  source: RulesResultSource;
  label: "Local Helper Engine" | "BoardState Authority";
  rulesVersion: string | null;
  adapterVersion: string | null;
  sessionAuthority: SessionAuthority;
}

export interface RulesReplayMarker {
  id: string;
  timestamp: string;
  label: string;
  description: string;
  groupId?: string;
}

export interface RulesResultNotification {
  id: string;
  kind:
    | "rules-warning"
    | "authority-unavailable"
    | "unsupported-card"
    | "manual-resolution"
    | "judge-note"
    | "replay-available"
    | "conflict-notice"
    | "info";
  message: string;
}

export interface RulesResultAnimation {
  id: string;
  kind:
    | "counter"
    | "life"
    | "token"
    | "status"
    | "transform"
    | "zone"
    | "attachment"
    | "highlight";
  groupIds: string[];
  label: string;
  mode: RulesRenderingMode;
}

export type RulesObjectReference = {
  groupId?: string;
  objectId?: string;
  objectIds?: string[];
  stackKey?: string;
  attachmentId?: string;
};

export type RulesResultChange =
  | {
      kind: "life";
      player: Owner;
      mode: "gain" | "loss" | "damage" | "pay" | "set";
      amount: number;
      nextValue?: number;
    }
  | {
      kind: "player-counter";
      counter: keyof FieldState["player"]["counters"];
      mode: "add" | "remove" | "set";
      amount: number;
    }
  | {
      kind: "counter";
      target: RulesObjectReference;
      counter: CounterName;
      mode: "add" | "remove" | "set";
      amount: number;
    }
  | {
      kind: "token";
      mode: "created" | "removed";
      target?: RulesObjectReference;
      name: string;
      quantity: number;
      power?: number;
      toughness?: number;
      subtypes?: string[];
      colors?: string[];
      tapped?: boolean;
      attacking?: boolean;
    }
  | {
      kind: "permanent";
      mode: "created" | "removed";
      target?: RulesObjectReference;
      label: string;
      quantity: number;
      zone?: Zone;
    }
  | {
      kind: "zone";
      target: RulesObjectReference;
      from?: Zone;
      to: Zone;
      quantity?: number;
    }
  | {
      kind: "attachment";
      attachment: RulesObjectReference;
      host: RulesObjectReference | null;
      mode: "attached" | "detached";
    }
  | {
      kind: "status";
      target: RulesObjectReference;
      status: keyof StatusFlags;
      value: boolean;
    }
  | {
      kind: "transform";
      target: RulesObjectReference;
      transformed: boolean;
      label?: string;
    }
  | {
      kind: "depower";
      target: RulesObjectReference;
      mode: FieldState["groups"][number]["depowerMode"];
    }
  | {
      kind: "tracking";
      target: RulesObjectReference;
      trackingEnabled: boolean;
    }
  | {
      kind: "power-toughness";
      target: RulesObjectReference;
      basePower?: number | null;
      baseToughness?: number | null;
      currentPower?: number | null;
      currentToughness?: number | null;
    }
  | {
      kind: "relevant-total";
      key: string;
      value: number;
    };

export interface CanonicalRulesResult {
  id: string;
  schemaVersion: number;
  fieldId: string;
  sessionId: string;
  source: RulesResultSource;
  authority: RulesResultAuthority;
  title: string;
  summary: string[];
  details: ResolutionStep[];
  events: GameEvent[];
  changes: RulesResultChange[];
  changedGroupIds: string[];
  warnings: string[];
  messages: string[];
  unsupportedInteractions: string[];
  judgeNotes: string[];
  replayMarkers: RulesReplayMarker[];
  loopDetected: boolean;
  createdAt: string;
  finalField?: FieldState;
}

export interface RulesResultValidation {
  status: RulesResultValidationStatus;
  errors: string[];
  warnings: string[];
}

export interface RulesRenderOptions {
  mode?: RulesRenderingMode;
  silent?: boolean;
  timestamp?: string;
}

export interface RulesRenderOutput {
  result: ResolutionResult;
  canonical: CanonicalRulesResult;
  validation: RulesResultValidation;
  animationQueue: RulesResultAnimation[];
  notifications: RulesResultNotification[];
  accessibilityAnnouncements: string[];
  diagnostics: RulesRendererDiagnostics;
}

export interface RulesRendererDiagnostics {
  rendererVersion: string;
  renderingSource: RulesResultSource;
  authoritySource: SessionAuthority;
  validationStatus: RulesResultValidationStatus;
  renderingDurationMs: number;
  animationMode: RulesRenderingMode;
  replayCompatible: boolean;
  lastRenderedAt: string;
  warnings: string[];
  lastError: string | null;
}
