import type { FieldState, PermanentGroup } from "../domain/types";
import type { RulesObjectReference } from "./types";

export interface ObjectResolution {
  group: PermanentGroup;
  groupId: string;
  objectIds: string[];
}

export interface ObjectResolver {
  resolve(reference: RulesObjectReference): ObjectResolution | null;
  hasParticipant(participantId: string): boolean;
}

export function createObjectResolver(field: FieldState): ObjectResolver {
  const byGroupId = new Map<string, PermanentGroup>();
  const byObjectId = new Map<string, PermanentGroup>();
  const byStackKey = new Map<string, PermanentGroup>();

  for (const group of field.groups) {
    byGroupId.set(group.id, group);
    if (group.stackKey) byStackKey.set(group.stackKey, group);
    for (const objectId of group.session?.objectIds ?? [group.id]) {
      byObjectId.set(objectId, group);
    }
    if (group.session?.objectId) byObjectId.set(group.session.objectId, group);
  }

  return {
    resolve(reference) {
      const group =
        lookupReference(reference, byGroupId, byObjectId, byStackKey) ?? null;
      if (!group) return null;
      return {
        group,
        groupId: group.id,
        objectIds: group.session?.objectIds ?? [group.id],
      };
    },
    hasParticipant(participantId) {
      return field.session.participants.some(
        (participant) => participant.id === participantId,
      );
    },
  };
}

function lookupReference(
  reference: RulesObjectReference,
  byGroupId: Map<string, PermanentGroup>,
  byObjectId: Map<string, PermanentGroup>,
  byStackKey: Map<string, PermanentGroup>,
): PermanentGroup | undefined {
  if (reference.groupId) return byGroupId.get(reference.groupId);
  if (reference.objectId) return byObjectId.get(reference.objectId);
  if (reference.attachmentId) return byObjectId.get(reference.attachmentId);
  if (reference.stackKey) return byStackKey.get(reference.stackKey);
  const objectId = reference.objectIds?.find((entry) => byObjectId.has(entry));
  return objectId ? byObjectId.get(objectId) : undefined;
}
