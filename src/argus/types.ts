import type {
  GameplayAuthoritySource,
  ObservationConfidence,
} from "../domain/actionSemantics";
import type { CardIdentity, GameEvent, StatusFlags } from "../domain/types";

export const ARGUS_STATE_VERSION = 1;

export type ArgusObservationKind =
  | "object-appeared"
  | "object-disappeared"
  | "identity"
  | "orientation-changed"
  | "board-snapshot"
  | "unknown-object";

export interface ArgusObservedObject {
  observationObjectId: string;
  matchedGroupId: string | null;
  identity: CardIdentity | null;
  label: string | null;
  location: { x: number; y: number; width: number; height: number } | null;
  statuses: Partial<StatusFlags>;
  confidence: ObservationConfidence;
}

export interface ArgusObservation {
  id: string;
  sessionId: string;
  kind: ArgusObservationKind;
  confidence: ObservationConfidence;
  sources: Array<
    | "camera"
    | "echo"
    | "athena"
    | "turn-context"
    | "planner"
    | "recent-events"
    | "user-correction"
  >;
  objects: ArgusObservedObject[];
  capturedAt: string;
  status: "unresolved" | "proposed" | "accepted" | "dismissed";
  canonicalEventId: string | null;
  note: string;
}

export interface ArgusBattlefieldSnapshot {
  id: string;
  capturedAt: string;
  observationIds: string[];
  objectIds: string[];
}

export interface ArgusSnapshotChangeSet {
  appearedObjectIds: string[];
  disappearedObjectIds: string[];
  retainedObjectIds: string[];
}

export interface ArgusCanonicalProposal {
  id: string;
  observationId: string;
  confidence: ObservationConfidence;
  authority: GameplayAuthoritySource;
  event: GameEvent;
  requiresConfirmation: boolean;
  reason: string;
}

export interface ArgusState {
  version: typeof ARGUS_STATE_VERSION;
  enabled: boolean;
  observations: ArgusObservation[];
  proposals: ArgusCanonicalProposal[];
  latestSnapshot: ArgusBattlefieldSnapshot | null;
  previousSnapshot: ArgusBattlefieldSnapshot | null;
  lastScanAt: string | null;
}

export interface ArgusCapturePort {
  readonly available: boolean;
  requestSnapshot(): Promise<ArgusObservation[]>;
  stop(): Promise<void>;
}
