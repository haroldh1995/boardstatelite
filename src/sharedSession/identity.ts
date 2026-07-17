import type { ObjectSessionBinding, SharedSessionMetadata } from "./types";

export const LOCAL_UNASSIGNED_SESSION_ID = "BS-SESSION-LOCAL-UNASSIGNED";

export function createSessionId(): string {
  return `BS-SESSION-${randomToken(32)}`;
}

export function createParticipantId(): string {
  return `BS-PARTICIPANT-${randomToken(24)}`;
}

export function createObjectId(seed?: string, index = 0): string {
  if (seed) return `BS-OBJ-${stableHash(`${seed}:${index}`)}`;
  return `BS-OBJ-${randomToken(24)}`;
}

export function createObjectBinding(input: {
  sessionId: string;
  groupId: string;
  quantity: number;
  ownerParticipantId: string;
  controllerParticipantId: string;
  existing?: Partial<ObjectSessionBinding> | null;
}): ObjectSessionBinding {
  const quantity = Math.max(1, Math.trunc(input.quantity));
  const existingIds = Array.isArray(input.existing?.objectIds)
    ? input.existing.objectIds.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      )
    : [];
  const objectIds = [...existingIds];
  for (let index = objectIds.length; index < quantity; index += 1) {
    objectIds.push(createObjectId(input.groupId, index));
  }
  const normalizedIds = objectIds.slice(0, quantity);
  return {
    sessionId: input.sessionId,
    objectId: normalizedIds[0] ?? createObjectId(input.groupId, 0),
    objectIds: normalizedIds,
    ownerParticipantId:
      typeof input.existing?.ownerParticipantId === "string"
        ? input.existing.ownerParticipantId
        : input.ownerParticipantId,
    controllerParticipantId:
      typeof input.existing?.controllerParticipantId === "string"
        ? input.existing.controllerParticipantId
        : input.controllerParticipantId,
    visibility: "localOnly",
    synchronizationState: "localOnly",
    authoritySource: "local-lite",
  };
}

export function localParticipantId(session: SharedSessionMetadata): string {
  return (
    session.participants.find((participant) => participant.local)?.id ??
    session.participants[0]?.id ??
    "BS-PARTICIPANT-LOCAL"
  );
}

function randomToken(length: number): string {
  const source =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return source.toUpperCase().padEnd(length, "0").slice(0, length);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}
