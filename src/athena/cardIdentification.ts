import { parseCharacteristics } from "../domain/cards";
import type { CardIdentity, FieldState, Zone } from "../domain/types";
import type { AthenaForecastInput } from "./eventForecastTypes";
import {
  ATHENA_CARD_IDENTIFICATION_VERSION,
  type AthenaCardEntryActionPolicy,
  type AthenaCardEntryConstraints,
  type AthenaCardEntryDescriptor,
  type AthenaCardEntryIdentity,
  type AthenaCardIdentificationActionResult,
  type AthenaCardIdentificationState,
  type AthenaPendingCardIdentification,
} from "./cardIdentificationTypes";

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const CARD_IDENTIFICATION_HISTORY_LIMIT = 20;
const PERMANENT_CARD_TYPES = new Set([
  "Artifact",
  "Battle",
  "Creature",
  "Enchantment",
  "Land",
  "Planeswalker",
]);

export function createDefaultAthenaCardIdentificationState(): AthenaCardIdentificationState {
  return {
    version: ATHENA_CARD_IDENTIFICATION_VERSION,
    activeRequestId: null,
    requests: [],
    recentCompletionIds: [],
  };
}

export function normalizeAthenaCardIdentificationState(
  value: unknown,
  options: {
    sessionId?: string | null;
    participantId?: string | null;
    timestamp?: string;
  } = {},
): AthenaCardIdentificationState {
  if (!value || typeof value !== "object") {
    return createDefaultAthenaCardIdentificationState();
  }
  const candidate = value as Partial<AthenaCardIdentificationState>;
  const requests = Array.isArray(candidate.requests)
    ? candidate.requests
        .map((entry) =>
          normalizePendingRequest(entry, {
            sessionId: options.sessionId,
            participantId: options.participantId,
            timestamp: options.timestamp,
          }),
        )
        .filter((entry): entry is AthenaPendingCardIdentification =>
          Boolean(entry),
        )
        .slice(-CARD_IDENTIFICATION_HISTORY_LIMIT)
    : [];
  const activeCandidate = text(candidate.activeRequestId);
  const active = requests.find(
    (entry) =>
      entry.id === activeCandidate &&
      ["pending", "presented", "resolving"].includes(entry.status),
  );
  const fallbackActive = [...requests]
    .reverse()
    .find((entry) =>
      ["pending", "presented", "resolving"].includes(entry.status),
    );
  return {
    version: ATHENA_CARD_IDENTIFICATION_VERSION,
    activeRequestId: active?.id ?? fallbackActive?.id ?? null,
    requests,
    recentCompletionIds: uniqueStrings(candidate.recentCompletionIds).slice(
      -CARD_IDENTIFICATION_HISTORY_LIMIT,
    ),
  };
}

export function normalizeAthenaCardEntryDescriptor(
  value: unknown,
): AthenaCardEntryDescriptor | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AthenaCardEntryDescriptor>;
  const identity = normalizeIdentity(candidate.identity);
  if (!identity) return null;
  const originZone = normalizeZone(candidate.originZone);
  const destinationZone =
    normalizeZone(candidate.destinationZone) ?? "battlefield";
  const destinationStatus = candidate.destinationStatus ?? {
    tapped: false,
    attacking: false,
    transformed: false,
    counterType: null,
    counterQuantity: 0,
  };
  const reasonCode = [
    "unspecified-card-entry",
    "exact-card-known",
    "exact-token-known",
    "known-copy",
    "unsupported-unstructured-effect",
  ].includes(String(candidate.reasonCode))
    ? (candidate.reasonCode as AthenaCardEntryDescriptor["reasonCode"])
    : reasonCodeForIdentity(identity);
  return {
    version: ATHENA_CARD_IDENTIFICATION_VERSION,
    identity,
    actionPolicy: normalizeActionPolicy(candidate.actionPolicy),
    originZone,
    destinationZone,
    destinationStatus: {
      tapped: Boolean(destinationStatus.tapped),
      attacking: Boolean(destinationStatus.attacking),
      transformed: Boolean(destinationStatus.transformed),
      counterType: nullableText(destinationStatus.counterType),
      counterQuantity: safeNonnegativeInteger(
        destinationStatus.counterQuantity,
      ),
    },
    constraints: normalizeCardEntryConstraints(candidate.constraints),
    sourceTriggerId: nullableText(candidate.sourceTriggerId),
    sourceAbilityId: nullableText(candidate.sourceAbilityId),
    reasonCode,
  };
}

export function createUnspecifiedCardEntryDescriptor(
  input: {
    actionPolicy?: AthenaCardEntryActionPolicy;
    originZone?: Zone | null;
    destinationZone?: Zone;
    tapped?: boolean;
    attacking?: boolean;
    transformed?: boolean;
    counterType?: string | null;
    counterQuantity?: number;
    cardTypes?: string[];
    permanentOnly?: boolean;
    maximumManaValue?: number | null;
    minimumManaValue?: number | null;
    description?: string | null;
    exhaustive?: boolean;
    sourceTriggerId?: string | null;
    sourceAbilityId?: string | null;
  } = {},
): AthenaCardEntryDescriptor {
  return {
    version: ATHENA_CARD_IDENTIFICATION_VERSION,
    identity: { kind: "unspecified-card" },
    actionPolicy: input.actionPolicy ?? "add-only",
    originZone: input.originZone ?? null,
    destinationZone: input.destinationZone ?? "battlefield",
    destinationStatus: {
      tapped: Boolean(input.tapped),
      attacking: Boolean(input.attacking),
      transformed: Boolean(input.transformed),
      counterType: nullableText(input.counterType),
      counterQuantity: safeNonnegativeInteger(input.counterQuantity),
    },
    constraints: normalizeCardEntryConstraints({
      cardTypes: input.cardTypes,
      permanentOnly: input.permanentOnly ?? true,
      maximumManaValue: input.maximumManaValue,
      minimumManaValue: input.minimumManaValue,
      description: input.description,
      exhaustive: input.exhaustive,
    }),
    sourceTriggerId: nullableText(input.sourceTriggerId),
    sourceAbilityId: nullableText(input.sourceAbilityId),
    reasonCode: "unspecified-card-entry",
  };
}

export function classifyAthenaCardEntry(
  field: FieldState,
  event: AthenaForecastInput,
):
  | { kind: "resolved"; event: AthenaForecastInput }
  | {
      kind: "identification-required";
      request: AthenaPendingCardIdentification;
    }
  | { kind: "manual-required"; reason: string } {
  const descriptor = event.cardEntry;
  if (!descriptor) return { kind: "resolved", event };
  if (descriptor.identity.kind === "unsupported-oracle-text") {
    return {
      kind: "manual-required",
      reason:
        "This effect is not structured enough for Lite to identify the resulting card safely.",
    };
  }
  if (descriptor.identity.kind === "named-token") {
    return { kind: "resolved", event: { ...event, cardEntry: null } };
  }
  if (descriptor.identity.kind === "named-card") {
    return {
      kind: "resolved",
      event: eventWithSelectedCard(event, descriptor.identity.card),
    };
  }
  if (descriptor.identity.kind === "copy-known-object") {
    const sourceGroupId = descriptor.identity.sourceGroupId;
    const source = field.groups.find((group) => group.id === sourceGroupId);
    if (!source?.identity) {
      return {
        kind: "manual-required",
        reason: "The known copy source is no longer available.",
      };
    }
    return {
      kind: "resolved",
      event: eventWithSelectedCard(event, source.identity),
    };
  }
  return {
    kind: "identification-required",
    request: createPendingCardIdentification(field, event, descriptor),
  };
}

export function enqueuePendingCardIdentification(
  field: FieldState,
  request: AthenaPendingCardIdentification,
): FieldState {
  const state = normalizeAthenaCardIdentificationState(
    field.athena.cardIdentification,
    {
      sessionId: field.session.id,
      participantId: field.multiplayer.registry.localParticipantId,
      timestamp: request.updatedAt,
    },
  );
  const existing = state.requests.find((entry) => entry.id === request.id);
  if (existing) {
    return {
      ...field,
      athena: {
        ...field.athena,
        cardIdentification: {
          ...state,
          activeRequestId:
            existing.status === "completed"
              ? state.activeRequestId
              : existing.id,
        },
      },
    };
  }
  return {
    ...field,
    athena: {
      ...field.athena,
      cardIdentification: {
        ...state,
        activeRequestId: request.id,
        requests: [...state.requests, request].slice(
          -CARD_IDENTIFICATION_HISTORY_LIMIT,
        ),
      },
    },
  };
}

export function activePendingCardIdentification(
  field: FieldState,
): AthenaPendingCardIdentification | null {
  const state = field.athena.cardIdentification;
  if (!state.activeRequestId) return null;
  return (
    state.requests.find(
      (entry) =>
        entry.id === state.activeRequestId &&
        ["pending", "presented", "resolving"].includes(entry.status),
    ) ?? null
  );
}

export function validateCardIdentificationSelection(
  card: CardIdentity,
  constraints: AthenaCardEntryConstraints,
  action: "cast" | "add",
): { valid: boolean; reason: string } {
  const characteristics = parseCharacteristics(card.typeLine, card);
  if (action === "add" && !isPermanentCard(card)) {
    return {
      valid: false,
      reason: `${card.name} is not a permanent that Lite can put onto the battlefield.`,
    };
  }
  if (
    constraints.permanentOnly &&
    !characteristics.cardTypes.some((type) => PERMANENT_CARD_TYPES.has(type))
  ) {
    return { valid: false, reason: "Choose a permanent card." };
  }
  if (
    constraints.cardTypes.length > 0 &&
    !constraints.cardTypes.some((type) =>
      characteristics.cardTypes.includes(type),
    )
  ) {
    return {
      valid: false,
      reason: `Choose ${constraints.cardTypes.join(" or ").toLowerCase()} card.`,
    };
  }
  if (
    constraints.maximumManaValue !== null &&
    card.manaValue > constraints.maximumManaValue
  ) {
    return {
      valid: false,
      reason: `Choose a card with mana value ${constraints.maximumManaValue} or less.`,
    };
  }
  if (
    constraints.minimumManaValue !== null &&
    card.manaValue < constraints.minimumManaValue
  ) {
    return {
      valid: false,
      reason: `Choose a card with mana value ${constraints.minimumManaValue} or greater.`,
    };
  }
  return { valid: true, reason: "Card selection is supported." };
}

export function createCardIdentificationAction(
  request: AthenaPendingCardIdentification,
  card: CardIdentity,
  action: "cast" | "add",
): AthenaCardIdentificationActionResult {
  if (!actionAllowed(request.actionPolicy, action)) {
    return {
      valid: false,
      reason:
        action === "cast"
          ? "This effect puts the card onto the battlefield without casting it."
          : "This effect requires the selected card to be cast.",
      action,
      requestId: request.id,
      selectedCard: card,
      eventDrafts: [],
    };
  }
  const validation = validateCardIdentificationSelection(
    card,
    request.constraints,
    action,
  );
  if (!validation.valid) {
    return {
      valid: false,
      reason: validation.reason,
      action,
      requestId: request.id,
      selectedCard: card,
      eventDrafts: [],
    };
  }
  const selectedEvent = eventWithSelectedCard(request.sourceEvent, card);
  if (action === "add") {
    return {
      valid: true,
      reason: `Put ${card.name} onto the battlefield without casting it.`,
      action,
      requestId: request.id,
      selectedCard: card,
      eventDrafts: [
        withIdentificationMetadata(selectedEvent, request.id, action),
      ],
    };
  }
  const castEvent: AthenaForecastInput = withIdentificationMetadata(
    {
      ...selectedEvent,
      id: `${selectedEvent.id}:cast`,
      eventId: `${selectedEvent.eventId}:cast`,
      eventCategory: "spell-cast",
      zoneDestination: null,
      cardEntry: null,
    },
    request.id,
    action,
  );
  const events = [castEvent];
  if (isPermanentCard(card)) {
    events.push(
      withIdentificationMetadata(
        {
          ...selectedEvent,
          id: `${selectedEvent.id}:entry`,
          eventId: `${selectedEvent.eventId}:entry`,
          subjectGroupIds: [],
          subjectObjectIds: [],
          zoneOrigin: null,
          cardEntry: null,
          metadata: {
            ...selectedEvent.metadata,
            castEventId: castEvent.eventId,
          },
        },
        request.id,
        action,
      ),
    );
  }
  return {
    valid: true,
    reason: `Cast ${card.name}.`,
    action,
    requestId: request.id,
    selectedCard: card,
    eventDrafts: events,
  };
}

export function createStandaloneCardIdentificationAction(
  field: FieldState,
  event: AthenaForecastInput,
  card: CardIdentity,
  action: "cast" | "add",
): AthenaCardIdentificationActionResult {
  const descriptor = createUnspecifiedCardEntryDescriptor({
    actionPolicy: "cast-or-add",
    originZone: event.zoneOrigin,
    destinationZone: event.zoneDestination ?? "battlefield",
    permanentOnly: action === "add",
  });
  return createCardIdentificationAction(
    createPendingCardIdentification(
      field,
      { ...event, cardEntry: descriptor },
      descriptor,
    ),
    card,
    action,
  );
}

export function completePendingCardIdentification(
  field: FieldState,
  input: {
    requestId: string;
    card: CardIdentity;
    action: "cast" | "add";
    completionEventIds: string[];
    timestamp: string;
  },
): FieldState {
  const state = field.athena.cardIdentification;
  const requests = state.requests.map((request) =>
    request.id === input.requestId
      ? {
          ...request,
          status: "completed" as const,
          selectedCardId: input.card.cardId,
          selectedCardName: input.card.name,
          selectedAction: input.action,
          completionEventIds: uniqueStrings(input.completionEventIds),
          updatedAt: input.timestamp,
          completedAt: input.timestamp,
        }
      : request,
  );
  const activeRequestId =
    state.activeRequestId === input.requestId
      ? (requests.find((entry) => entry.status === "pending")?.id ?? null)
      : state.activeRequestId;
  return {
    ...field,
    athena: {
      ...field.athena,
      cardIdentification: {
        ...state,
        activeRequestId,
        requests,
        recentCompletionIds: uniqueStrings([
          ...state.recentCompletionIds,
          input.requestId,
        ]).slice(-CARD_IDENTIFICATION_HISTORY_LIMIT),
      },
    },
  };
}

export function actionAllowed(
  policy: AthenaCardEntryActionPolicy,
  action: "cast" | "add",
): boolean {
  return (
    policy === "cast-or-add" ||
    (policy === "cast-only" && action === "cast") ||
    (policy === "add-only" && action === "add")
  );
}

export function isPermanentCard(card: CardIdentity): boolean {
  return parseCharacteristics(card.typeLine, card).cardTypes.some((type) =>
    PERMANENT_CARD_TYPES.has(type),
  );
}

function createPendingCardIdentification(
  field: FieldState,
  event: AthenaForecastInput,
  descriptor: AthenaCardEntryDescriptor,
): AthenaPendingCardIdentification {
  const id = `athena-card-identification:${stableHash(
    `${event.canonicalSessionId}:${event.eventId}:${descriptor.sourceTriggerId ?? "none"}:${descriptor.sourceAbilityId ?? "none"}`,
  )}`;
  return {
    version: ATHENA_CARD_IDENTIFICATION_VERSION,
    id,
    sessionId: event.canonicalSessionId,
    participantId: event.participantId,
    sourceEventId: event.eventId,
    sourceTriggerId: descriptor.sourceTriggerId,
    sourceAbilityId: descriptor.sourceAbilityId,
    sourceObjectId: event.sourceObjectId,
    originZone: descriptor.originZone ?? event.zoneOrigin,
    destinationZone: descriptor.destinationZone,
    destinationStatus: { ...descriptor.destinationStatus },
    constraints: {
      ...descriptor.constraints,
      cardTypes: [...descriptor.constraints.cardTypes],
    },
    actionPolicy: descriptor.actionPolicy,
    exactIdentityUnresolved: true,
    canonicalStateVersion: field.updatedAt,
    authoritySource: event.authoritySource,
    authorityPrecedence: event.authorityPrecedence,
    status: "pending",
    selectedCardId: null,
    selectedCardName: null,
    selectedAction: null,
    completionEventIds: [],
    reasonCode: descriptor.reasonCode,
    semanticPrompt: "Choose the card entering the battlefield.",
    sourceEvent: cloneForecastInput(event),
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
    completedAt: null,
  };
}

function eventWithSelectedCard(
  event: AthenaForecastInput,
  card: CardIdentity,
): AthenaForecastInput {
  const characteristics = parseCharacteristics(card.typeLine, card);
  const descriptor = event.cardEntry;
  return {
    ...cloneForecastInput(event),
    permanentDefinition: cloneCard(card),
    knownCharacteristics: {
      cardTypes: [...characteristics.cardTypes],
      supertypes: [...characteristics.supertypes],
      subtypes: [...characteristics.subtypes],
      colors: [...characteristics.colors],
      manaValue: characteristics.manaValue,
      isToken: characteristics.isToken,
      isCreature: characteristics.isCreature,
      isLegendary: characteristics.isLegendary,
      knownFields: [
        "cardTypes",
        "supertypes",
        "subtypes",
        "colors",
        "manaValue",
        "isToken",
        "isCreature",
        "isLegendary",
      ],
    },
    zoneOrigin: descriptor?.originZone ?? event.zoneOrigin,
    zoneDestination: descriptor?.destinationZone ?? event.zoneDestination,
    cardEntry: null,
    metadata: {
      ...event.metadata,
      label: card.name,
      entersTapped:
        descriptor?.destinationStatus.tapped ??
        Boolean(event.metadata.entersTapped),
      entersAttacking:
        descriptor?.destinationStatus.attacking ??
        Boolean(event.metadata.entersAttacking),
      entersTransformed:
        descriptor?.destinationStatus.transformed ??
        Boolean(event.metadata.entersTransformed),
      entryCounterType:
        descriptor?.destinationStatus.counterType ??
        event.metadata.entryCounterType ??
        null,
      entryCounterQuantity:
        descriptor?.destinationStatus.counterQuantity ??
        event.metadata.entryCounterQuantity ??
        0,
    },
  };
}

function withIdentificationMetadata(
  event: AthenaForecastInput,
  requestId: string,
  action: "cast" | "add",
): AthenaForecastInput {
  return {
    ...event,
    metadata: {
      ...event.metadata,
      cardIdentificationId: requestId,
      cardSelectionAction: action,
    },
  };
}

function normalizePendingRequest(
  value: unknown,
  options: {
    sessionId?: string | null;
    participantId?: string | null;
    timestamp?: string;
  },
): AthenaPendingCardIdentification | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AthenaPendingCardIdentification>;
  const id = text(candidate.id);
  const sessionId = text(candidate.sessionId);
  const participantId = text(candidate.participantId);
  if (
    !id ||
    !sessionId ||
    !participantId ||
    !candidate.sourceEvent ||
    (options.sessionId && sessionId !== options.sessionId) ||
    (options.participantId && participantId !== options.participantId)
  ) {
    return null;
  }
  const sourceEvent = cloneForecastInput(candidate.sourceEvent);
  const status = [
    "pending",
    "presented",
    "resolving",
    "completed",
    "cancelled",
    "stale",
    "manual-required",
  ].includes(String(candidate.status))
    ? (candidate.status as AthenaPendingCardIdentification["status"])
    : "pending";
  return {
    version: ATHENA_CARD_IDENTIFICATION_VERSION,
    id,
    sessionId,
    participantId,
    sourceEventId: text(candidate.sourceEventId) || sourceEvent.eventId,
    sourceTriggerId: nullableText(candidate.sourceTriggerId),
    sourceAbilityId: nullableText(candidate.sourceAbilityId),
    sourceObjectId: nullableText(candidate.sourceObjectId),
    originZone: normalizeZone(candidate.originZone),
    destinationZone: normalizeZone(candidate.destinationZone) ?? "battlefield",
    destinationStatus: {
      tapped: Boolean(candidate.destinationStatus?.tapped),
      attacking: Boolean(candidate.destinationStatus?.attacking),
      transformed: Boolean(candidate.destinationStatus?.transformed),
      counterType: nullableText(candidate.destinationStatus?.counterType),
      counterQuantity: safeNonnegativeInteger(
        candidate.destinationStatus?.counterQuantity,
      ),
    },
    constraints: normalizeCardEntryConstraints(candidate.constraints),
    actionPolicy: normalizeActionPolicy(candidate.actionPolicy),
    exactIdentityUnresolved: true,
    canonicalStateVersion: text(candidate.canonicalStateVersion),
    authoritySource: candidate.authoritySource ?? "lite-local-helper-result",
    authorityPrecedence: candidate.authorityPrecedence ?? 2,
    status,
    selectedCardId: nullableText(candidate.selectedCardId),
    selectedCardName: nullableText(candidate.selectedCardName),
    selectedAction:
      candidate.selectedAction === "cast" || candidate.selectedAction === "add"
        ? candidate.selectedAction
        : null,
    completionEventIds: uniqueStrings(candidate.completionEventIds),
    reasonCode: candidate.reasonCode ?? "unspecified-card-entry",
    semanticPrompt:
      text(candidate.semanticPrompt) ||
      "Choose the card entering the battlefield.",
    sourceEvent,
    createdAt: timestamp(candidate.createdAt, options.timestamp),
    updatedAt: timestamp(candidate.updatedAt, options.timestamp),
    completedAt: candidate.completedAt
      ? timestamp(candidate.completedAt, options.timestamp)
      : null,
  };
}

function normalizeIdentity(value: unknown): AthenaCardEntryIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as AthenaCardEntryIdentity;
  if (candidate.kind === "named-card" && candidate.card?.cardId) {
    return { kind: "named-card", card: cloneCard(candidate.card) };
  }
  if (candidate.kind === "named-token" && text(candidate.name)) {
    return { kind: "named-token", name: text(candidate.name) };
  }
  if (candidate.kind === "copy-known-object" && text(candidate.sourceGroupId)) {
    return {
      kind: "copy-known-object",
      sourceGroupId: text(candidate.sourceGroupId),
    };
  }
  if (candidate.kind === "unspecified-card") return candidate;
  if (candidate.kind === "unsupported-oracle-text") return candidate;
  return null;
}

function normalizeCardEntryConstraints(
  value: Partial<AthenaCardEntryConstraints> | null | undefined,
): AthenaCardEntryConstraints {
  return {
    cardTypes: uniqueStrings(value?.cardTypes),
    permanentOnly: value?.permanentOnly !== false,
    maximumManaValue: finiteNumberOrNull(value?.maximumManaValue),
    minimumManaValue: finiteNumberOrNull(value?.minimumManaValue),
    description: nullableText(value?.description),
    exhaustive: Boolean(value?.exhaustive),
  };
}

function cloneForecastInput(event: AthenaForecastInput): AthenaForecastInput {
  return {
    ...event,
    subjectGroupIds: [...event.subjectGroupIds],
    subjectObjectIds: [...event.subjectObjectIds],
    knownCharacteristics: event.knownCharacteristics
      ? {
          ...event.knownCharacteristics,
          cardTypes: [...event.knownCharacteristics.cardTypes],
          supertypes: [...event.knownCharacteristics.supertypes],
          subtypes: [...event.knownCharacteristics.subtypes],
          colors: [...event.knownCharacteristics.colors],
          knownFields: [...event.knownCharacteristics.knownFields],
        }
      : null,
    tokenDefinition: event.tokenDefinition
      ? {
          ...event.tokenDefinition,
          characteristics: {
            ...event.tokenDefinition.characteristics,
            cardTypes: [...event.tokenDefinition.characteristics.cardTypes],
            supertypes: [...event.tokenDefinition.characteristics.supertypes],
            subtypes: [...event.tokenDefinition.characteristics.subtypes],
            colors: [...event.tokenDefinition.characteristics.colors],
            knownFields: [...event.tokenDefinition.characteristics.knownFields],
          },
        }
      : null,
    permanentDefinition: event.permanentDefinition
      ? cloneCard(event.permanentDefinition)
      : null,
    cardEntry: event.cardEntry
      ? normalizeAthenaCardEntryDescriptor(event.cardEntry)
      : null,
    relevantTotalImplications: { ...event.relevantTotalImplications },
    metadata: { ...event.metadata },
  };
}

function cloneCard(card: CardIdentity): CardIdentity {
  return {
    ...card,
    colors: [...card.colors],
    colorIdentity: [...card.colorIdentity],
    keywords: [...card.keywords],
    cardFaces: card.cardFaces.map((face) => ({ ...face })),
  };
}

function reasonCodeForIdentity(
  identity: AthenaCardEntryIdentity,
): AthenaCardEntryDescriptor["reasonCode"] {
  if (identity.kind === "named-card") return "exact-card-known";
  if (identity.kind === "named-token") return "exact-token-known";
  if (identity.kind === "copy-known-object") return "known-copy";
  if (identity.kind === "unsupported-oracle-text") {
    return "unsupported-unstructured-effect";
  }
  return "unspecified-card-entry";
}

function normalizeActionPolicy(value: unknown): AthenaCardEntryActionPolicy {
  if (value === "cast-only" || value === "cast-or-add") return value;
  return "add-only";
}

function normalizeZone(value: unknown): Zone | null {
  return [
    "battlefield",
    "hand",
    "graveyard",
    "exile",
    "library",
    "command",
  ].includes(String(value))
    ? (value as Zone)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown): string | null {
  return text(value) || null;
}

function finiteNumberOrNull(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function safeNonnegativeInteger(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((entry): entry is string => Boolean(text(entry))),
        ),
      ]
    : [];
}

function timestamp(value: unknown, fallback = DEFAULT_TIMESTAMP): string {
  const candidate = text(value);
  return candidate && !Number.isNaN(Date.parse(candidate))
    ? candidate
    : fallback;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
