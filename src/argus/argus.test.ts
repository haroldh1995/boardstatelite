import { describe, expect, it } from "vitest";
import { makeId } from "../domain/cards";
import type { GameEvent } from "../domain/types";
import {
  compareArgusSnapshots,
  createDefaultArgusState,
  proposeArgusCanonicalEvent,
  recordArgusObservation,
  recordArgusSnapshot,
  resolveArgusProposal,
} from "./argus";
import type { ArgusObservation } from "./types";

const observation = (
  confidence: ArgusObservation["confidence"],
): ArgusObservation => ({
  id: makeId("observation"),
  sessionId: "session",
  kind: "object-appeared",
  confidence,
  sources: ["camera"],
  objects: [],
  capturedAt: "2026-09-26T00:00:00.000Z",
  status: "unresolved",
  canonicalEventId: null,
  note: "A card-shaped object appeared.",
});

const event: GameEvent = {
  id: "event-1",
  type: "permanent-entered",
  sourceId: null,
  controller: "you",
  owner: "you",
  quantity: 1,
  batchId: "batch-1",
  groupIds: [],
  metadata: {},
};

describe("ARGUS observation boundary", () => {
  it("records observations and snapshots without creating canonical events", () => {
    const observed = observation("probable");
    const state = recordArgusSnapshot(createDefaultArgusState(), [observed]);
    expect(state.observations[0].canonicalEventId).toBeNull();
    expect(state.proposals).toHaveLength(0);
    expect(state.latestSnapshot?.observationIds).toEqual([observed.id]);
  });

  it("turns uncertain evidence into a proposal that requires acceptance", () => {
    const observed = observation("uncertain");
    const state = proposeArgusCanonicalEvent(
      recordArgusObservation(createDefaultArgusState(), observed),
      observed.id,
      event,
      "Possible permanent entry",
    );
    expect(state.proposals[0].requiresConfirmation).toBe(true);
    expect(state.observations[0].canonicalEventId).toBeNull();
  });

  it("links canonical state only after explicit proposal resolution", () => {
    const observed = observation("confirmed");
    const proposed = proposeArgusCanonicalEvent(
      recordArgusObservation(createDefaultArgusState(), observed),
      observed.id,
      event,
      "Multimodal match",
    );
    const accepted = resolveArgusProposal(
      proposed,
      proposed.proposals[0].id,
      "accepted",
      event.id,
    );
    expect(accepted.observations[0].status).toBe("accepted");
    expect(accepted.observations[0].canonicalEventId).toBe(event.id);
  });

  it("reconciles rescans by reporting appeared, retained, and missing objects", () => {
    const changes = compareArgusSnapshots(
      {
        id: "before",
        capturedAt: "2026-09-26T00:00:00.000Z",
        observationIds: [],
        objectIds: ["forest", "sol-ring"],
      },
      {
        id: "after",
        capturedAt: "2026-09-26T00:01:00.000Z",
        observationIds: [],
        objectIds: ["forest", "arcane-signet"],
      },
    );
    expect(changes).toEqual({
      appearedObjectIds: ["arcane-signet"],
      disappearedObjectIds: ["sol-ring"],
      retainedObjectIds: ["forest"],
    });
  });
});
