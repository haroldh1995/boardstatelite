import type { CardIdentity, Zone } from "../domain/types";
import type { AthenaForecastInput } from "./eventForecastTypes";
import type { AthenaAuthorityPrecedence, AthenaAuthoritySource } from "./types";

export const ATHENA_CARD_IDENTIFICATION_VERSION = 1;

export type AthenaCardEntryActionPolicy =
  | "cast-only"
  | "add-only"
  | "cast-or-add";

export type AthenaCardEntryIdentity =
  | { kind: "named-card"; card: CardIdentity }
  | { kind: "named-token"; name: string }
  | { kind: "copy-known-object"; sourceGroupId: string }
  | { kind: "unspecified-card" }
  | { kind: "unsupported-oracle-text" };

export interface AthenaCardEntryConstraints {
  cardTypes: string[];
  permanentOnly: boolean;
  maximumManaValue: number | null;
  minimumManaValue: number | null;
  description: string | null;
  exhaustive: boolean;
}

export interface AthenaCardEntryDescriptor {
  version: typeof ATHENA_CARD_IDENTIFICATION_VERSION;
  identity: AthenaCardEntryIdentity;
  actionPolicy: AthenaCardEntryActionPolicy;
  originZone: Zone | null;
  destinationZone: Zone;
  destinationStatus: {
    tapped: boolean;
    attacking: boolean;
    transformed: boolean;
    counterType: string | null;
    counterQuantity: number;
  };
  constraints: AthenaCardEntryConstraints;
  sourceTriggerId: string | null;
  sourceAbilityId: string | null;
  reasonCode:
    | "unspecified-card-entry"
    | "exact-card-known"
    | "exact-token-known"
    | "known-copy"
    | "unsupported-unstructured-effect";
}

export type AthenaPendingCardIdentificationStatus =
  | "pending"
  | "presented"
  | "resolving"
  | "completed"
  | "cancelled"
  | "stale"
  | "manual-required";

export interface AthenaPendingCardIdentification {
  version: typeof ATHENA_CARD_IDENTIFICATION_VERSION;
  id: string;
  sessionId: string;
  participantId: string;
  sourceEventId: string;
  sourceTriggerId: string | null;
  sourceAbilityId: string | null;
  sourceObjectId: string | null;
  originZone: Zone | null;
  destinationZone: Zone;
  destinationStatus: AthenaCardEntryDescriptor["destinationStatus"];
  constraints: AthenaCardEntryConstraints;
  actionPolicy: AthenaCardEntryActionPolicy;
  exactIdentityUnresolved: true;
  canonicalStateVersion: string;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  status: AthenaPendingCardIdentificationStatus;
  selectedCardId: string | null;
  selectedCardName: string | null;
  selectedAction: "cast" | "add" | null;
  completionEventIds: string[];
  reasonCode: AthenaCardEntryDescriptor["reasonCode"];
  semanticPrompt: string;
  sourceEvent: AthenaForecastInput;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AthenaCardIdentificationState {
  version: typeof ATHENA_CARD_IDENTIFICATION_VERSION;
  activeRequestId: string | null;
  requests: AthenaPendingCardIdentification[];
  recentCompletionIds: string[];
}

export interface AthenaCardIdentificationActionResult {
  valid: boolean;
  reason: string;
  action: "cast" | "add";
  requestId: string | null;
  selectedCard: CardIdentity;
  eventDrafts: AthenaForecastInput[];
}
