import { makeId } from "../domain/cards";
import { observationRequiresAcceptance } from "../domain/actionSemantics";
import type { GameEvent } from "../domain/types";
import {
  ARGUS_STATE_VERSION,
  type ArgusBattlefieldSnapshot,
  type ArgusCanonicalProposal,
  type ArgusObservation,
  type ArgusSnapshotChangeSet,
  type ArgusState,
} from "./types";

export function createDefaultArgusState(): ArgusState {
  return {
    version: ARGUS_STATE_VERSION,
    enabled: false,
    observations: [],
    proposals: [],
    latestSnapshot: null,
    previousSnapshot: null,
    lastScanAt: null,
  };
}

export function normalizeArgusState(value: unknown): ArgusState {
  const defaults = createDefaultArgusState();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<ArgusState>;
  return {
    ...defaults,
    enabled: candidate.enabled === true,
    observations: Array.isArray(candidate.observations)
      ? candidate.observations.slice(-120)
      : [],
    proposals: Array.isArray(candidate.proposals)
      ? candidate.proposals.slice(-60)
      : [],
    latestSnapshot: candidate.latestSnapshot ?? null,
    previousSnapshot: candidate.previousSnapshot ?? null,
    lastScanAt:
      typeof candidate.lastScanAt === "string" ? candidate.lastScanAt : null,
  };
}

export function recordArgusObservation(
  state: ArgusState,
  observation: ArgusObservation,
): ArgusState {
  return {
    ...state,
    observations: [
      ...state.observations.filter((entry) => entry.id !== observation.id),
      { ...observation, canonicalEventId: null },
    ].slice(-120),
  };
}

export function recordArgusSnapshot(
  state: ArgusState,
  observations: ArgusObservation[],
  timestamp = new Date().toISOString(),
): ArgusState {
  const snapshot: ArgusBattlefieldSnapshot = {
    id: makeId("argus-snapshot"),
    capturedAt: timestamp,
    observationIds: observations.map((entry) => entry.id),
    objectIds: observations.flatMap((entry) =>
      entry.objects.map((object) => object.observationObjectId),
    ),
  };
  return {
    ...observations.reduce(recordArgusObservation, state),
    previousSnapshot: state.latestSnapshot,
    latestSnapshot: snapshot,
    lastScanAt: timestamp,
  };
}

export function compareArgusSnapshots(
  previous: ArgusBattlefieldSnapshot | null,
  current: ArgusBattlefieldSnapshot,
): ArgusSnapshotChangeSet {
  const previousIds = new Set(previous?.objectIds ?? []);
  const currentIds = new Set(current.objectIds);
  return {
    appearedObjectIds: [...currentIds].filter((id) => !previousIds.has(id)),
    disappearedObjectIds: [...previousIds].filter((id) => !currentIds.has(id)),
    retainedObjectIds: [...currentIds].filter((id) => previousIds.has(id)),
  };
}

export function proposeArgusCanonicalEvent(
  state: ArgusState,
  observationId: string,
  event: GameEvent,
  reason: string,
): ArgusState {
  const observation = state.observations.find(
    (entry) => entry.id === observationId,
  );
  if (!observation || observation.status === "dismissed") return state;
  const proposal: ArgusCanonicalProposal = {
    id: makeId("argus-proposal"),
    observationId,
    confidence: observation.confidence,
    authority:
      observation.sources.length > 1
        ? "multimodal-observation"
        : "single-source-observation",
    event,
    requiresConfirmation: observationRequiresAcceptance(observation.confidence),
    reason,
  };
  return {
    ...state,
    observations: state.observations.map((entry) =>
      entry.id === observationId ? { ...entry, status: "proposed" } : entry,
    ),
    proposals: [
      ...state.proposals.filter(
        (entry) => entry.observationId !== observationId,
      ),
      proposal,
    ].slice(-60),
  };
}

export function resolveArgusProposal(
  state: ArgusState,
  proposalId: string,
  resolution: "accepted" | "dismissed",
  canonicalEventId: string | null = null,
): ArgusState {
  const proposal = state.proposals.find((entry) => entry.id === proposalId);
  if (!proposal) return state;
  return {
    ...state,
    proposals: state.proposals.filter((entry) => entry.id !== proposalId),
    observations: state.observations.map((entry) =>
      entry.id === proposal.observationId
        ? { ...entry, status: resolution, canonicalEventId }
        : entry,
    ),
  };
}
