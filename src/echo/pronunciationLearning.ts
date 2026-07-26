import { makeId } from "../domain/cards";
import type { CardIdentity, FieldState, Owner, Zone } from "../domain/types";
import type { AmbientConfidenceLevel } from "./ambientConfidenceTypes";
import type {
  EchoDeckSnapshotCard,
  EchoEntityKind,
  EchoEntityResolutionAmbiguity,
  EchoEntityResolutionCandidate,
  EchoEntityResolutionResult,
} from "./entityResolutionTypes";
import {
  ECHO_PRONUNCIATION_LEARNING_VERSION,
  type EchoPronunciationCanonicalEntity,
  type EchoPronunciationLearningDecision,
  type EchoPronunciationLearningDiagnostics,
  type EchoPronunciationLearningSettings,
  type EchoPronunciationLearningSignal,
  type EchoPronunciationLearningSignalSource,
  type EchoPronunciationLearningState,
  type EchoPronunciationLearningStatus,
  type EchoPronunciationLearningSensitivity,
  type EchoPronunciationPlayerAlias,
  type EchoPronunciationVocabularyEntry,
  type EchoPronunciationVocabularyScope,
} from "./pronunciationLearningTypes";

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const NORMALIZATION_LIMIT = 120;

export function createDefaultPronunciationLearningSettings(
  input: Partial<EchoPronunciationLearningSettings> = {},
): EchoPronunciationLearningSettings {
  return {
    version: ECHO_PRONUNCIATION_LEARNING_VERSION,
    enabled: input.enabled ?? true,
    automaticLearning: input.automaticLearning ?? true,
    learningSensitivity: normalizeLearningSensitivity(
      input.learningSensitivity,
    ),
    minimumConfirmations: clampInteger(input.minimumConfirmations, 2, 12, 3),
    maxVocabularyEntries: clampInteger(
      input.maxVocabularyEntries,
      10,
      1000,
      120,
    ),
    confidenceBoostLimit: clampFraction(input.confidenceBoostLimit, 0.2),
    importExportPrepared: true,
    privacyControlsPrepared: true,
    localizationReady: true,
    rawAudioRetained: false,
    localOnly: true,
    lastResetAt:
      typeof input.lastResetAt === "string" ? input.lastResetAt : null,
  };
}

export function normalizePronunciationLearningSettings(
  value: unknown,
): EchoPronunciationLearningSettings {
  const defaults = createDefaultPronunciationLearningSettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoPronunciationLearningSettings>;
  return {
    ...defaults,
    enabled:
      candidate.enabled === undefined
        ? defaults.enabled
        : Boolean(candidate.enabled),
    automaticLearning:
      candidate.automaticLearning === undefined
        ? defaults.automaticLearning
        : Boolean(candidate.automaticLearning),
    learningSensitivity: normalizeLearningSensitivity(
      candidate.learningSensitivity,
    ),
    minimumConfirmations: clampInteger(
      candidate.minimumConfirmations,
      2,
      12,
      defaults.minimumConfirmations,
    ),
    maxVocabularyEntries: clampInteger(
      candidate.maxVocabularyEntries,
      10,
      1000,
      defaults.maxVocabularyEntries,
    ),
    confidenceBoostLimit: clampFraction(
      candidate.confidenceBoostLimit,
      defaults.confidenceBoostLimit,
    ),
    importExportPrepared: true,
    privacyControlsPrepared: true,
    localizationReady: true,
    rawAudioRetained: false,
    localOnly: true,
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
  };
}

export function createDefaultPronunciationLearningState(
  input: Partial<EchoPronunciationLearningState> = {},
): EchoPronunciationLearningState {
  return {
    version: ECHO_PRONUNCIATION_LEARNING_VERSION,
    entries: [],
    playerAliases: [],
    playgroupVocabulary: [],
    deckVocabulary: [],
    ...input,
    diagnostics: createPronunciationLearningDiagnostics({
      ...(input.diagnostics ?? {}),
      activeEntryCount:
        input.diagnostics?.activeEntryCount ??
        countActive([
          ...(input.entries ?? []),
          ...(input.playgroupVocabulary ?? []),
          ...(input.deckVocabulary ?? []),
        ]),
    }),
  };
}

export function normalizePronunciationLearningState(
  value: unknown,
  options: {
    fallbackTimestamp?: string;
    settings?: EchoPronunciationLearningSettings;
    knownGroupIds?: string[];
    knownCardIds?: string[];
  } = {},
): EchoPronunciationLearningState {
  const settings = normalizePronunciationLearningSettings(options.settings);
  if (!value || typeof value !== "object") {
    return createDefaultPronunciationLearningState();
  }
  const candidate = value as Partial<EchoPronunciationLearningState>;
  const knownGroupIds = new Set(options.knownGroupIds ?? []);
  const knownCardIds = new Set(options.knownCardIds ?? []);
  const timestamp = options.fallbackTimestamp ?? DEFAULT_TIMESTAMP;
  const entries = normalizeVocabularyList(candidate.entries, {
    timestamp,
    settings,
    knownGroupIds,
    knownCardIds,
    scopeFallback: "personal",
  });
  const playgroupVocabulary = normalizeVocabularyList(
    candidate.playgroupVocabulary,
    {
      timestamp,
      settings,
      knownGroupIds,
      knownCardIds,
      scopeFallback: "playgroup",
    },
  );
  const deckVocabulary = normalizeVocabularyList(candidate.deckVocabulary, {
    timestamp,
    settings,
    knownGroupIds,
    knownCardIds,
    scopeFallback: "deck",
  });
  const playerAliases = Array.isArray(candidate.playerAliases)
    ? candidate.playerAliases
        .map((alias) => normalizePlayerAlias(alias, timestamp))
        .filter((alias): alias is EchoPronunciationPlayerAlias =>
          Boolean(alias),
        )
        .slice(0, settings.maxVocabularyEntries)
    : [];
  return createDefaultPronunciationLearningState({
    entries,
    playerAliases,
    playgroupVocabulary,
    deckVocabulary,
    diagnostics: createPronunciationLearningDiagnostics({
      ...(candidate.diagnostics && typeof candidate.diagnostics === "object"
        ? candidate.diagnostics
        : {}),
      activeEntryCount: countActive([
        ...entries,
        ...playgroupVocabulary,
        ...deckVocabulary,
      ]),
      candidateEntryCount: countCandidates([
        ...entries,
        ...playgroupVocabulary,
        ...deckVocabulary,
      ]),
      playerAliasCount: playerAliases.length,
      deckVocabularyCount: deckVocabulary.length,
      playgroupVocabularyCount: playgroupVocabulary.length,
      rawAudioRetained: false,
      localOnly: true,
      directBattlefieldMutation: false,
    }),
  });
}

export function observePronunciationLearningSignal(
  state: EchoPronunciationLearningState,
  signal: EchoPronunciationLearningSignal,
  options: {
    settings?: EchoPronunciationLearningSettings;
    timestamp?: string;
  } = {},
): {
  state: EchoPronunciationLearningState;
  decision: EchoPronunciationLearningDecision;
} {
  const settings = normalizePronunciationLearningSettings(options.settings);
  const timestamp =
    options.timestamp ?? signal.timestamp ?? new Date().toISOString();
  const phrase = cleanPhrase(signal.phrase);
  const normalizedPhrase = normalizePronunciationText(phrase);
  const accepted = isAcceptedLearningSignal(signal);
  if (!settings.enabled || !settings.automaticLearning || !normalizedPhrase) {
    return {
      state: normalizePronunciationLearningState(state, { settings }),
      decision: createPronunciationDecision({
        action: "ignored",
        entryId: null,
        reason: "Pronunciation learning is disabled or the phrase is empty.",
        settings,
      }),
    };
  }
  if (!accepted) {
    const normalized = normalizePronunciationLearningState(state, { settings });
    return {
      state: {
        ...normalized,
        diagnostics: createPronunciationLearningDiagnostics({
          ...normalized.diagnostics,
          lastDecision: "rejected",
          lastReason: "Rejected interactions do not teach pronunciation.",
        }),
      },
      decision: createPronunciationDecision({
        action: "rejected",
        entryId: null,
        reason: "Rejected interactions do not teach pronunciation.",
        settings,
      }),
    };
  }

  const normalized = normalizePronunciationLearningState(state, { settings });
  const canonical = normalizeCanonicalEntity(signal.canonical);
  const targetKey = canonicalKey(canonical);
  const existing = normalized.entries.find(
    (entry) =>
      entry.normalizedPhrase === normalizedPhrase &&
      canonicalKey(entry.canonical) === targetKey,
  );
  const confirmationCount = (existing?.successfulConfirmationCount ?? 0) + 1;
  const observationCount = (existing?.observationCount ?? 0) + 1;
  const manualCorrectionCount =
    (existing?.manualCorrectionCount ?? 0) +
    (signal.source === "manual-correction" ? 1 : 0);
  const requiredConfirmations = requiredConfirmationCount(settings, signal);
  const status: EchoPronunciationLearningStatus =
    confirmationCount >= requiredConfirmations ? "active" : "candidate";
  const confidenceBoost =
    status === "active"
      ? Math.min(
          settings.confidenceBoostLimit,
          0.04 + confirmationCount * boostStep(settings.learningSensitivity),
        )
      : 0;
  const learnedFrom = learnedFromSignal(signal.source);
  const entry: EchoPronunciationVocabularyEntry = {
    version: ECHO_PRONUNCIATION_LEARNING_VERSION,
    id: existing?.id ?? makeId("echo-pronunciation"),
    scope: signal.deckContextId ? "deck" : "personal",
    phrase,
    normalizedPhrase,
    aliases: dedupeStrings([...(existing?.aliases ?? []), phrase]),
    canonical,
    status,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    lastUsedAt: timestamp,
    observationCount,
    successfulConfirmationCount: confirmationCount,
    manualCorrectionCount,
    rejectedCount: existing?.rejectedCount ?? 0,
    confidenceBoost,
    learnedFrom,
    deckContextId: signal.deckContextId ?? existing?.deckContextId ?? null,
    playgroupId: signal.playgroupId ?? existing?.playgroupId ?? null,
    speakerDecision: signal.speakerVerification?.decision ?? null,
    rawAudioRetained: false,
    userEditable: true,
  };
  const nextEntries = [
    entry,
    ...normalized.entries.filter((candidate) => candidate.id !== entry.id),
  ].slice(0, settings.maxVocabularyEntries);
  const nextState = createDefaultPronunciationLearningState({
    ...normalized,
    entries: nextEntries,
    diagnostics: createPronunciationLearningDiagnostics({
      ...normalized.diagnostics,
      activeEntryCount: countActive([
        ...nextEntries,
        ...normalized.playgroupVocabulary,
        ...normalized.deckVocabulary,
      ]),
      candidateEntryCount: countCandidates([
        ...nextEntries,
        ...normalized.playgroupVocabulary,
        ...normalized.deckVocabulary,
      ]),
      lastLearnedAt:
        status === "active" ? timestamp : normalized.diagnostics.lastLearnedAt,
      lastDecision: status === "active" ? "activated" : "candidate-updated",
      lastReason:
        status === "active"
          ? "Repeated confirmations activated a personal pronunciation mapping."
          : "Pronunciation observation recorded as a candidate.",
    }),
  });
  return {
    state: nextState,
    decision: createPronunciationDecision({
      action: status === "active" ? "activated" : "candidate-updated",
      entryId: entry.id,
      reason:
        status === "active"
          ? "Repeated confirmations activated a personal pronunciation mapping."
          : "Pronunciation observation recorded as a candidate.",
      confidenceBoost,
      requiredConfirmations,
      settings,
    }),
  };
}

export function addPersonalVocabularyEntry(
  state: EchoPronunciationLearningState,
  input: {
    phrase: string;
    canonical: EchoPronunciationCanonicalEntity;
    scope?: EchoPronunciationVocabularyScope;
    timestamp?: string;
    settings?: EchoPronunciationLearningSettings;
  },
): EchoPronunciationLearningState {
  const settings = normalizePronunciationLearningSettings(input.settings);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const phrase = cleanPhrase(input.phrase);
  const normalizedPhrase = normalizePronunciationText(phrase);
  if (!normalizedPhrase)
    return normalizePronunciationLearningState(state, { settings });
  const normalized = normalizePronunciationLearningState(state, { settings });
  const entry: EchoPronunciationVocabularyEntry = {
    version: ECHO_PRONUNCIATION_LEARNING_VERSION,
    id: makeId("echo-pronunciation"),
    scope: input.scope ?? "personal",
    phrase,
    normalizedPhrase,
    aliases: [phrase],
    canonical: normalizeCanonicalEntity(input.canonical),
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: null,
    observationCount: settings.minimumConfirmations,
    successfulConfirmationCount: settings.minimumConfirmations,
    manualCorrectionCount: 0,
    rejectedCount: 0,
    confidenceBoost: settings.confidenceBoostLimit,
    learnedFrom: "user",
    deckContextId: null,
    playgroupId: null,
    speakerDecision: null,
    rawAudioRetained: false,
    userEditable: true,
  };
  return upsertScopedEntry(normalized, entry, settings, timestamp);
}

export function updatePersonalVocabularyEntry(
  state: EchoPronunciationLearningState,
  entryId: string,
  update: {
    phrase?: string;
    status?: EchoPronunciationLearningStatus;
    canonical?: EchoPronunciationCanonicalEntity;
    timestamp?: string;
    settings?: EchoPronunciationLearningSettings;
  },
): EchoPronunciationLearningState {
  const settings = normalizePronunciationLearningSettings(update.settings);
  const timestamp = update.timestamp ?? new Date().toISOString();
  const normalized = normalizePronunciationLearningState(state, { settings });
  const updateEntry = (
    entry: EchoPronunciationVocabularyEntry,
  ): EchoPronunciationVocabularyEntry =>
    entry.id !== entryId
      ? entry
      : {
          ...entry,
          phrase: update.phrase ? cleanPhrase(update.phrase) : entry.phrase,
          normalizedPhrase: update.phrase
            ? normalizePronunciationText(update.phrase)
            : entry.normalizedPhrase,
          aliases: update.phrase
            ? dedupeStrings([update.phrase, ...entry.aliases])
            : entry.aliases,
          canonical: update.canonical
            ? normalizeCanonicalEntity(update.canonical)
            : entry.canonical,
          status: update.status ?? entry.status,
          updatedAt: timestamp,
          rawAudioRetained: false,
          userEditable: true,
        };
  return normalizePronunciationLearningState(
    {
      ...normalized,
      entries: normalized.entries.map(updateEntry),
      playgroupVocabulary: normalized.playgroupVocabulary.map(updateEntry),
      deckVocabulary: normalized.deckVocabulary.map(updateEntry),
      diagnostics: createPronunciationLearningDiagnostics({
        ...normalized.diagnostics,
        lastAppliedAt: timestamp,
        lastDecision: "observed",
        lastReason: "Learned vocabulary entry edited.",
      }),
    },
    { settings },
  );
}

export function removePronunciationVocabularyEntry(
  state: EchoPronunciationLearningState,
  entryId: string,
  options: {
    timestamp?: string;
    settings?: EchoPronunciationLearningSettings;
  } = {},
): EchoPronunciationLearningState {
  const settings = normalizePronunciationLearningSettings(options.settings);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const normalized = normalizePronunciationLearningState(state, { settings });
  return normalizePronunciationLearningState(
    {
      ...normalized,
      entries: normalized.entries.filter((entry) => entry.id !== entryId),
      playgroupVocabulary: normalized.playgroupVocabulary.filter(
        (entry) => entry.id !== entryId,
      ),
      deckVocabulary: normalized.deckVocabulary.filter(
        (entry) => entry.id !== entryId,
      ),
      diagnostics: createPronunciationLearningDiagnostics({
        ...normalized.diagnostics,
        lastAppliedAt: timestamp,
        lastDecision: "observed",
        lastReason: "Learned vocabulary entry deleted.",
      }),
    },
    { settings },
  );
}

export function addPlayerAlias(
  state: EchoPronunciationLearningState,
  input: {
    alias: string;
    displayName: string;
    owner?: Owner;
    playerId?: string | null;
    timestamp?: string;
    settings?: EchoPronunciationLearningSettings;
  },
): EchoPronunciationLearningState {
  const settings = normalizePronunciationLearningSettings(input.settings);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const normalized = normalizePronunciationLearningState(state, { settings });
  const alias = cleanPhrase(input.alias);
  const normalizedAlias = normalizePronunciationText(alias);
  if (!normalizedAlias) return normalized;
  const existing = normalized.playerAliases.find(
    (entry) => entry.normalizedAlias === normalizedAlias,
  );
  const playerAlias: EchoPronunciationPlayerAlias = {
    id: existing?.id ?? makeId("echo-player-alias"),
    alias,
    normalizedAlias,
    playerId: input.playerId ?? existing?.playerId ?? null,
    displayName: cleanPhrase(input.displayName || alias),
    owner: input.owner ?? existing?.owner ?? "opponent",
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    successfulUseCount: existing?.successfulUseCount ?? 0,
    userEditable: true,
  };
  return normalizePronunciationLearningState(
    {
      ...normalized,
      playerAliases: [
        playerAlias,
        ...normalized.playerAliases.filter(
          (entry) => entry.id !== playerAlias.id,
        ),
      ],
      diagnostics: createPronunciationLearningDiagnostics({
        ...normalized.diagnostics,
        playerAliasCount: normalized.playerAliases.length,
        lastAppliedAt: timestamp,
        lastDecision: "observed",
        lastReason: "Player alias saved.",
      }),
    },
    { settings },
  );
}

export function removePlayerAlias(
  state: EchoPronunciationLearningState,
  aliasId: string,
  options: {
    timestamp?: string;
    settings?: EchoPronunciationLearningSettings;
  } = {},
): EchoPronunciationLearningState {
  const settings = normalizePronunciationLearningSettings(options.settings);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const normalized = normalizePronunciationLearningState(state, { settings });
  return normalizePronunciationLearningState(
    {
      ...normalized,
      playerAliases: normalized.playerAliases.filter(
        (entry) => entry.id !== aliasId,
      ),
      diagnostics: createPronunciationLearningDiagnostics({
        ...normalized.diagnostics,
        lastAppliedAt: timestamp,
        lastDecision: "observed",
        lastReason: "Player alias deleted.",
      }),
    },
    { settings },
  );
}

export function addDeckVocabularyEntry(
  state: EchoPronunciationLearningState,
  input: {
    phrase: string;
    card: CardIdentity | EchoDeckSnapshotCard;
    deckContextId?: string | null;
    timestamp?: string;
    settings?: EchoPronunciationLearningSettings;
  },
): EchoPronunciationLearningState {
  return addScopedVocabularyEntry(state, {
    scope: "deck",
    phrase: input.phrase,
    canonical: canonicalEntityFromCard(input.card),
    deckContextId: input.deckContextId ?? null,
    timestamp: input.timestamp,
    settings: input.settings,
  });
}

export function addPlaygroupVocabularyEntry(
  state: EchoPronunciationLearningState,
  input: {
    phrase: string;
    canonical: EchoPronunciationCanonicalEntity;
    playgroupId?: string | null;
    timestamp?: string;
    settings?: EchoPronunciationLearningSettings;
  },
): EchoPronunciationLearningState {
  return addScopedVocabularyEntry(state, {
    scope: "playgroup",
    phrase: input.phrase,
    canonical: input.canonical,
    playgroupId: input.playgroupId ?? null,
    timestamp: input.timestamp,
    settings: input.settings,
  });
}

export function resetPronunciationLearningState(
  options: {
    timestamp?: string;
    settings?: EchoPronunciationLearningSettings;
  } = {},
): EchoPronunciationLearningState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return createDefaultPronunciationLearningState({
    diagnostics: createPronunciationLearningDiagnostics({
      lastResetAt: timestamp,
      lastDecision: "reset",
      lastReason: "Learned pronunciation vocabulary reset.",
    }),
  });
}

export function applyPronunciationLearningToResolutionResult(
  result: EchoEntityResolutionResult,
  options: {
    field: FieldState;
    state?: EchoPronunciationLearningState;
    settings?: EchoPronunciationLearningSettings;
    deckSnapshot?: EchoDeckSnapshotCard[] | CardIdentity[];
    expectedKinds?: EchoEntityKind[];
    timestamp?: string;
  },
): EchoEntityResolutionResult {
  const settings = normalizePronunciationLearningSettings(options.settings);
  if (!settings.enabled) return result;
  const state = normalizePronunciationLearningState(
    options.state ?? options.field.pronunciationLearning,
    {
      settings,
      knownGroupIds: options.field.groups.map((group) => group.id),
      knownCardIds: options.field.groups
        .map((group) => group.identity?.cardId)
        .filter((entry): entry is string => Boolean(entry)),
    },
  );
  const phrase = normalizePronunciationText(result.text);
  if (!phrase) return result;
  const activeEntries = allVocabularyEntries(state).filter(
    (entry) => entry.status === "active" && phraseMatchesEntry(phrase, entry),
  );
  const playerAlias = state.playerAliases.find(
    (entry) => entry.normalizedAlias === phrase,
  );
  if (!activeEntries.length && !playerAlias) return result;

  const expectedKinds = new Set(options.expectedKinds ?? []);
  const adaptedCandidates = [...result.candidates];
  for (const entry of activeEntries) {
    const existingIndex = adaptedCandidates.findIndex((candidate) =>
      candidateMatchesCanonical(candidate, entry.canonical),
    );
    if (existingIndex >= 0) {
      adaptedCandidates[existingIndex] = boostCandidate(
        adaptedCandidates[existingIndex],
        entry.confidenceBoost,
        entry.phrase,
      );
    } else {
      const synthetic = candidateFromVocabularyEntry(entry, options.field, {
        deckSnapshot: options.deckSnapshot,
      });
      if (synthetic && candidateKindAllowed(synthetic.kind, expectedKinds)) {
        adaptedCandidates.push(synthetic);
      }
    }
  }
  if (playerAlias) {
    const aliasCandidate = candidateFromPlayerAlias(playerAlias);
    if (candidateKindAllowed(aliasCandidate.kind, expectedKinds)) {
      adaptedCandidates.push(aliasCandidate);
    }
  }
  const sorted = adaptedCandidates
    .map((candidate) => ({
      ...candidate,
      score: Math.max(0, Math.min(1, candidate.score)),
      confidenceLevel: confidenceLevelForScore(candidate.score),
    }))
    .sort(
      (left, right) =>
        right.priorityRank - left.priorityRank ||
        right.score - left.score ||
        left.label.localeCompare(right.label),
    );
  const selected = chooseAdaptedCandidate(sorted);
  const ambiguities = selected
    ? []
    : createAdaptedAmbiguities(sorted, activeEntries, playerAlias);
  const status = selected
    ? "resolved"
    : sorted.length
      ? "ambiguous"
      : "missing";
  const confidence: EchoEntityResolutionResult["confidence"] = selected
    ? {
        level: selected.confidenceLevel,
        score: selected.score,
        reasons: [
          `Personal vocabulary matched ${selected.label}.`,
          ...result.confidence.reasons.slice(0, 2),
        ],
      }
    : {
        level: sorted.length ? "low" : "unknown",
        score: sorted[0]?.score ?? null,
        reasons: ambiguities.map((entry) => entry.message),
      };
  return {
    ...result,
    status,
    selected: selected ?? null,
    candidates: sorted,
    ambiguities,
    confidence,
    resolvedEntities: selected?.entity ? [selected.entity] : [],
    diagnostics: {
      ...result.diagnostics,
      status,
      lastSelectedId: selected?.id ?? null,
      candidateCount: sorted.length,
      ambiguityCount: ambiguities.length,
    },
    accessibilityAnnouncement: selected
      ? `${selected.label} resolved from personal vocabulary.`
      : "Personal vocabulary found more than one possible match.",
    directBattlefieldMutation: false,
  };
}

export function canonicalEntityFromGroup(
  group: FieldState["groups"][number],
): EchoPronunciationCanonicalEntity {
  return normalizeCanonicalEntity({
    kind: "battlefield-object",
    label: group.label,
    normalizedLabel: normalizePronunciationText(group.label),
    cardId: group.identity?.cardId ?? null,
    groupId: group.id,
    objectIds: group.session?.objectIds ?? [group.id],
    owner: group.owner,
    zone: group.zone,
    entity: { kind: "group", id: group.id, role: "target" },
    source: "battlefield",
  });
}

export function canonicalEntityFromCard(
  card: CardIdentity | EchoDeckSnapshotCard,
  source: EchoPronunciationCanonicalEntity["source"] = "canonical-card",
): EchoPronunciationCanonicalEntity {
  return normalizeCanonicalEntity({
    kind: "card",
    label: card.name,
    normalizedLabel: normalizePronunciationText(card.name),
    cardId: card.cardId,
    groupId: null,
    objectIds: [],
    owner: null,
    zone: null,
    entity: null,
    source,
  });
}

export function canonicalEntityFromPlayer(input: {
  label: string;
  owner?: Owner;
  playerId?: string | null;
}): EchoPronunciationCanonicalEntity {
  const owner = input.owner ?? "opponent";
  return normalizeCanonicalEntity({
    kind: owner === "you" ? "player" : "opponent",
    label: input.label,
    normalizedLabel: normalizePronunciationText(input.label),
    cardId: null,
    groupId: null,
    objectIds: [],
    owner,
    zone: null,
    entity: { kind: "player", owner, role: "target" },
    source: "player-alias",
  });
}

export function normalizePronunciationText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9+/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NORMALIZATION_LIMIT);
}

function addScopedVocabularyEntry(
  state: EchoPronunciationLearningState,
  input: {
    scope: EchoPronunciationVocabularyScope;
    phrase: string;
    canonical: EchoPronunciationCanonicalEntity;
    deckContextId?: string | null;
    playgroupId?: string | null;
    timestamp?: string;
    settings?: EchoPronunciationLearningSettings;
  },
): EchoPronunciationLearningState {
  const settings = normalizePronunciationLearningSettings(input.settings);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const phrase = cleanPhrase(input.phrase);
  const normalizedPhrase = normalizePronunciationText(phrase);
  if (!normalizedPhrase)
    return normalizePronunciationLearningState(state, { settings });
  const normalized = normalizePronunciationLearningState(state, { settings });
  const entry: EchoPronunciationVocabularyEntry = {
    version: ECHO_PRONUNCIATION_LEARNING_VERSION,
    id: makeId("echo-pronunciation"),
    scope: input.scope,
    phrase,
    normalizedPhrase,
    aliases: [phrase],
    canonical: normalizeCanonicalEntity(input.canonical),
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: null,
    observationCount: settings.minimumConfirmations,
    successfulConfirmationCount: settings.minimumConfirmations,
    manualCorrectionCount: 0,
    rejectedCount: 0,
    confidenceBoost: settings.confidenceBoostLimit,
    learnedFrom: input.scope === "deck" ? "deck-context" : "user",
    deckContextId: input.deckContextId ?? null,
    playgroupId: input.playgroupId ?? null,
    speakerDecision: null,
    rawAudioRetained: false,
    userEditable: true,
  };
  return upsertScopedEntry(normalized, entry, settings, timestamp);
}

function upsertScopedEntry(
  state: EchoPronunciationLearningState,
  entry: EchoPronunciationVocabularyEntry,
  settings: EchoPronunciationLearningSettings,
  timestamp: string,
): EchoPronunciationLearningState {
  const replace = (entries: EchoPronunciationVocabularyEntry[]) =>
    [
      entry,
      ...entries.filter(
        (candidate) =>
          candidate.id !== entry.id &&
          candidate.normalizedPhrase !== entry.normalizedPhrase,
      ),
    ].slice(0, settings.maxVocabularyEntries);
  const next =
    entry.scope === "deck"
      ? { ...state, deckVocabulary: replace(state.deckVocabulary) }
      : entry.scope === "playgroup"
        ? { ...state, playgroupVocabulary: replace(state.playgroupVocabulary) }
        : { ...state, entries: replace(state.entries) };
  return normalizePronunciationLearningState(
    {
      ...next,
      diagnostics: createPronunciationLearningDiagnostics({
        ...state.diagnostics,
        lastLearnedAt: timestamp,
        lastDecision: "activated",
        lastReason: "Vocabulary entry saved.",
      }),
    },
    { settings },
  );
}

function normalizeVocabularyList(
  value: unknown,
  options: {
    timestamp: string;
    settings: EchoPronunciationLearningSettings;
    knownGroupIds: Set<string>;
    knownCardIds: Set<string>;
    scopeFallback: EchoPronunciationVocabularyScope;
  },
): EchoPronunciationVocabularyEntry[] {
  return Array.isArray(value)
    ? value
        .map((entry) => normalizeVocabularyEntry(entry, options))
        .filter((entry): entry is EchoPronunciationVocabularyEntry =>
          Boolean(entry),
        )
        .slice(0, options.settings.maxVocabularyEntries)
    : [];
}

function normalizeVocabularyEntry(
  value: unknown,
  options: {
    timestamp: string;
    knownGroupIds: Set<string>;
    knownCardIds: Set<string>;
    scopeFallback: EchoPronunciationVocabularyScope;
  },
): EchoPronunciationVocabularyEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoPronunciationVocabularyEntry>;
  const phrase = cleanPhrase(candidate.phrase ?? "");
  const normalizedPhrase = normalizePronunciationText(
    candidate.normalizedPhrase || phrase,
  );
  if (!normalizedPhrase) return null;
  const canonical = normalizeCanonicalEntity(candidate.canonical);
  const groupKnown =
    !canonical.groupId ||
    !options.knownGroupIds.size ||
    options.knownGroupIds.has(canonical.groupId);
  const cardKnown =
    !canonical.cardId ||
    !options.knownCardIds.size ||
    options.knownCardIds.has(canonical.cardId) ||
    candidate.scope === "deck";
  if (!groupKnown || !cardKnown) return null;
  return {
    version: ECHO_PRONUNCIATION_LEARNING_VERSION,
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : makeId("echo-pronunciation"),
    scope: normalizeScope(candidate.scope, options.scopeFallback),
    phrase,
    normalizedPhrase,
    aliases: Array.isArray(candidate.aliases)
      ? dedupeStrings(candidate.aliases.filter(isString)).slice(0, 12)
      : [phrase],
    canonical,
    status: normalizeLearningStatus(candidate.status),
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : options.timestamp,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : options.timestamp,
    lastUsedAt:
      typeof candidate.lastUsedAt === "string" ? candidate.lastUsedAt : null,
    observationCount: clampInteger(candidate.observationCount, 0, 99999, 0),
    successfulConfirmationCount: clampInteger(
      candidate.successfulConfirmationCount,
      0,
      99999,
      0,
    ),
    manualCorrectionCount: clampInteger(
      candidate.manualCorrectionCount,
      0,
      99999,
      0,
    ),
    rejectedCount: clampInteger(candidate.rejectedCount, 0, 99999, 0),
    confidenceBoost: clampFraction(candidate.confidenceBoost, 0),
    learnedFrom:
      candidate.learnedFrom === "repeated-confirmation" ||
      candidate.learnedFrom === "clarification" ||
      candidate.learnedFrom === "manual-correction" ||
      candidate.learnedFrom === "deck-context"
        ? candidate.learnedFrom
        : "user",
    deckContextId:
      typeof candidate.deckContextId === "string"
        ? candidate.deckContextId
        : null,
    playgroupId:
      typeof candidate.playgroupId === "string" ? candidate.playgroupId : null,
    speakerDecision: candidate.speakerDecision ?? null,
    rawAudioRetained: false,
    userEditable: true,
  };
}

function normalizeCanonicalEntity(
  value: Partial<EchoPronunciationCanonicalEntity> | null | undefined,
): EchoPronunciationCanonicalEntity {
  const label = cleanPhrase(value?.label ?? "Unknown entity");
  const groupId = typeof value?.groupId === "string" ? value.groupId : null;
  const cardId = typeof value?.cardId === "string" ? value.cardId : null;
  const owner =
    value?.owner === "you" || value?.owner === "opponent" ? value.owner : null;
  return {
    kind:
      value?.kind === "card" ||
      value?.kind === "battlefield-object" ||
      value?.kind === "commander" ||
      value?.kind === "token" ||
      value?.kind === "player" ||
      value?.kind === "opponent" ||
      value?.kind === "counter" ||
      value?.kind === "zone" ||
      value?.kind === "phrase"
        ? value.kind
        : groupId
          ? "battlefield-object"
          : cardId
            ? "card"
            : "phrase",
    label,
    normalizedLabel: normalizePronunciationText(
      value?.normalizedLabel || label,
    ),
    cardId,
    groupId,
    objectIds: Array.isArray(value?.objectIds)
      ? value.objectIds.filter(isString)
      : groupId
        ? [groupId]
        : [],
    owner,
    zone: normalizeZone(value?.zone),
    entity:
      value?.entity && typeof value.entity === "object"
        ? value.entity
        : groupId
          ? { kind: "group", id: groupId, role: "target" }
          : owner
            ? { kind: "player", owner, role: "target" }
            : null,
    source:
      value?.source === "battlefield" ||
      value?.source === "player-alias" ||
      value?.source === "user-vocabulary"
        ? value.source
        : "canonical-card",
  };
}

function normalizePlayerAlias(
  value: unknown,
  timestamp: string,
): EchoPronunciationPlayerAlias | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoPronunciationPlayerAlias>;
  const alias = cleanPhrase(candidate.alias ?? "");
  const normalizedAlias = normalizePronunciationText(
    candidate.normalizedAlias || alias,
  );
  if (!normalizedAlias) return null;
  return {
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : makeId("echo-player-alias"),
    alias,
    normalizedAlias,
    playerId:
      typeof candidate.playerId === "string" ? candidate.playerId : null,
    displayName: cleanPhrase(candidate.displayName || alias),
    owner: candidate.owner === "you" ? "you" : "opponent",
    createdAt:
      typeof candidate.createdAt === "string" ? candidate.createdAt : timestamp,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : timestamp,
    successfulUseCount: clampInteger(candidate.successfulUseCount, 0, 99999, 0),
    userEditable: true,
  };
}

function createPronunciationLearningDiagnostics(
  input: Partial<EchoPronunciationLearningDiagnostics>,
): EchoPronunciationLearningDiagnostics {
  return {
    version: ECHO_PRONUNCIATION_LEARNING_VERSION,
    activeEntryCount: input.activeEntryCount ?? 0,
    candidateEntryCount: input.candidateEntryCount ?? 0,
    playerAliasCount: input.playerAliasCount ?? 0,
    deckVocabularyCount: input.deckVocabularyCount ?? 0,
    playgroupVocabularyCount: input.playgroupVocabularyCount ?? 0,
    lastLearnedAt: input.lastLearnedAt ?? null,
    lastAppliedAt: input.lastAppliedAt ?? null,
    lastResetAt: input.lastResetAt ?? null,
    lastDecision: input.lastDecision ?? null,
    lastReason: input.lastReason ?? null,
    localOnly: true,
    rawAudioRetained: false,
    directBattlefieldMutation: false,
  };
}

function createPronunciationDecision(input: {
  action: EchoPronunciationLearningDecision["action"];
  entryId: string | null;
  reason: string;
  confidenceBoost?: number;
  requiredConfirmations?: number;
  settings: EchoPronunciationLearningSettings;
}): EchoPronunciationLearningDecision {
  return {
    version: ECHO_PRONUNCIATION_LEARNING_VERSION,
    action: input.action,
    entryId: input.entryId,
    reason: input.reason,
    confidenceBoost: input.confidenceBoost ?? 0,
    requiredConfirmations:
      input.requiredConfirmations ?? input.settings.minimumConfirmations,
    directBattlefieldMutation: false,
  };
}

function candidateFromVocabularyEntry(
  entry: EchoPronunciationVocabularyEntry,
  field: FieldState,
  options: { deckSnapshot?: EchoDeckSnapshotCard[] | CardIdentity[] },
): EchoEntityResolutionCandidate | null {
  const canonical = entry.canonical;
  const group = canonical.groupId
    ? field.groups.find((candidate) => candidate.id === canonical.groupId)
    : null;
  if (group) {
    return {
      id: `pronunciation:${entry.id}:${group.id}`,
      kind:
        canonical.kind === "commander"
          ? "commander"
          : group.characteristics.isToken
            ? "tokenStack"
            : "permanent",
      label: group.label,
      normalizedLabel: normalizePronunciationText(group.label),
      priority: "battlefield",
      priorityRank: 925,
      score: Math.min(1, 0.88 + entry.confidenceBoost),
      confidenceLevel: confidenceLevelForScore(0.88 + entry.confidenceBoost),
      entity: { kind: "group", id: group.id, role: "target" },
      groupId: group.id,
      objectIds: group.session?.objectIds ?? [group.id],
      owner: group.owner,
      controller: group.controller,
      zone: group.zone,
      cardId: group.identity?.cardId ?? canonical.cardId,
      source: "battlefield",
      relationshipIds: [],
      relationshipSummary: [`Personal phrase "${entry.phrase}"`],
      metadata: {
        pronunciationEntryId: entry.id,
        personalVocabulary: true,
      },
    };
  }
  const deckCard = canonical.cardId
    ? (options.deckSnapshot ?? []).find(
        (card) => card.cardId === canonical.cardId,
      )
    : null;
  if (deckCard) {
    return {
      id: `pronunciation:${entry.id}:${deckCard.cardId}`,
      kind: "card",
      label: deckCard.name,
      normalizedLabel: normalizePronunciationText(deckCard.name),
      priority: "deckSnapshot",
      priorityRank: 575,
      score: Math.min(1, 0.74 + entry.confidenceBoost),
      confidenceLevel: confidenceLevelForScore(0.74 + entry.confidenceBoost),
      entity: null,
      groupId: null,
      objectIds: [],
      owner: null,
      controller: null,
      zone: null,
      cardId: deckCard.cardId,
      source: "deck-snapshot",
      relationshipIds: [],
      relationshipSummary: [`Deck phrase "${entry.phrase}"`],
      metadata: {
        pronunciationEntryId: entry.id,
        deckVocabulary: true,
      },
    };
  }
  if (canonical.owner) {
    return candidateFromPlayerAlias({
      id: entry.id,
      alias: entry.phrase,
      normalizedAlias: entry.normalizedPhrase,
      playerId: null,
      displayName: canonical.label,
      owner: canonical.owner,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      successfulUseCount: entry.successfulConfirmationCount,
      userEditable: true,
    });
  }
  return null;
}

function candidateFromPlayerAlias(
  alias: EchoPronunciationPlayerAlias,
): EchoEntityResolutionCandidate {
  const owner = alias.owner;
  return {
    id: `player-alias:${alias.id}`,
    kind: owner === "you" ? "player" : "opponent",
    label: alias.displayName,
    normalizedLabel: normalizePronunciationText(alias.displayName),
    priority: "recent",
    priorityRank: 675,
    score: 0.94,
    confidenceLevel: "high",
    entity: { kind: "player", owner, role: "target" },
    groupId: null,
    objectIds: [],
    owner,
    controller: owner,
    zone: null,
    cardId: null,
    source: "recent",
    relationshipIds: [],
    relationshipSummary: [`Player alias "${alias.alias}"`],
    metadata: {
      playerAliasId: alias.id,
      personalVocabulary: true,
    },
  };
}

function boostCandidate(
  candidate: EchoEntityResolutionCandidate,
  boost: number,
  phrase: string,
): EchoEntityResolutionCandidate {
  const score = Math.min(1, candidate.score + boost);
  return {
    ...candidate,
    priorityRank: Math.max(candidate.priorityRank, 925),
    score,
    confidenceLevel: confidenceLevelForScore(score),
    relationshipSummary: [
      ...candidate.relationshipSummary,
      `Personal phrase "${phrase}"`,
    ],
    metadata: {
      ...candidate.metadata,
      personalVocabulary: true,
    },
  };
}

function chooseAdaptedCandidate(
  candidates: EchoEntityResolutionCandidate[],
): EchoEntityResolutionCandidate | null {
  const top = candidates[0];
  if (!top || top.score < 0.68) return null;
  const second = candidates[1];
  if (!second) return top;
  if (top.priorityRank > second.priorityRank) return top;
  return top.score - second.score >= 0.08 ? top : null;
}

function candidateKindAllowed(
  kind: EchoEntityKind,
  expectedKinds: Set<EchoEntityKind>,
): boolean {
  return !expectedKinds.size || expectedKinds.has(kind);
}

function createAdaptedAmbiguities(
  candidates: EchoEntityResolutionCandidate[],
  entries: EchoPronunciationVocabularyEntry[],
  alias: EchoPronunciationPlayerAlias | undefined,
): EchoEntityResolutionAmbiguity[] {
  if (!candidates.length) {
    return [
      {
        type: "missing-entity",
        message: "Learned vocabulary did not match an available entity.",
        candidates: [],
      },
    ];
  }
  return [
    {
      type: alias ? "multiple-players" : "multiple-battlefield-objects",
      message:
        entries.length > 1
          ? "Multiple learned vocabulary entries match this phrase."
          : "Personal vocabulary still has more than one possible target.",
      candidates: candidates.slice(0, 5).map((candidate) => candidate.label),
    },
  ];
}

function allVocabularyEntries(
  state: EchoPronunciationLearningState,
): EchoPronunciationVocabularyEntry[] {
  return [
    ...state.entries,
    ...state.playgroupVocabulary,
    ...state.deckVocabulary,
  ];
}

function phraseMatchesEntry(
  normalizedPhrase: string,
  entry: EchoPronunciationVocabularyEntry,
): boolean {
  return (
    entry.normalizedPhrase === normalizedPhrase ||
    entry.aliases.some(
      (alias) => normalizePronunciationText(alias) === normalizedPhrase,
    )
  );
}

function candidateMatchesCanonical(
  candidate: EchoEntityResolutionCandidate,
  canonical: EchoPronunciationCanonicalEntity,
): boolean {
  if (canonical.groupId && candidate.groupId === canonical.groupId) return true;
  if (canonical.cardId && candidate.cardId === canonical.cardId) return true;
  return candidate.normalizedLabel === canonical.normalizedLabel;
}

function isAcceptedLearningSignal(
  signal: EchoPronunciationLearningSignal,
): boolean {
  if (signal.outcome === "rejected") return false;
  if (!signal.speakerVerification?.verified) return false;
  return (
    signal.speakerVerification.confidence.level === "high" ||
    signal.speakerVerification.confidence.level === "medium" ||
    signal.source === "manual-correction" ||
    signal.source === "clarification-response"
  );
}

function requiredConfirmationCount(
  settings: EchoPronunciationLearningSettings,
  signal: EchoPronunciationLearningSignal,
): number {
  const base = settings.minimumConfirmations;
  if (
    signal.source === "manual-correction" ||
    signal.source === "clarification-response"
  ) {
    return Math.max(2, base);
  }
  if (settings.learningSensitivity === "conservative") return base + 1;
  if (settings.learningSensitivity === "adaptive") return Math.max(2, base - 1);
  return base;
}

function learnedFromSignal(source: EchoPronunciationLearningSignalSource) {
  if (source === "manual-correction") return "manual-correction" as const;
  if (source === "clarification-response") return "clarification" as const;
  return "repeated-confirmation" as const;
}

function boostStep(sensitivity: EchoPronunciationLearningSensitivity): number {
  if (sensitivity === "conservative") return 0.025;
  if (sensitivity === "adaptive") return 0.045;
  return 0.035;
}

function countActive(entries: EchoPronunciationVocabularyEntry[]): number {
  return entries.filter((entry) => entry.status === "active").length;
}

function countCandidates(entries: EchoPronunciationVocabularyEntry[]): number {
  return entries.filter((entry) => entry.status === "candidate").length;
}

function canonicalKey(canonical: EchoPronunciationCanonicalEntity): string {
  return [
    canonical.kind,
    canonical.groupId,
    canonical.cardId,
    canonical.owner,
    canonical.normalizedLabel,
  ]
    .filter(Boolean)
    .join(":");
}

function normalizeScope(
  value: unknown,
  fallback: EchoPronunciationVocabularyScope,
): EchoPronunciationVocabularyScope {
  return value === "personal" ||
    value === "playgroup" ||
    value === "deck" ||
    value === "player"
    ? value
    : fallback;
}

function normalizeLearningStatus(
  value: unknown,
): EchoPronunciationLearningStatus {
  return value === "active" || value === "disabled" ? value : "candidate";
}

function normalizeLearningSensitivity(
  value: unknown,
): EchoPronunciationLearningSensitivity {
  return value === "conservative" || value === "adaptive" ? value : "balanced";
}

function normalizeZone(value: unknown): Zone | null {
  return value === "battlefield" ||
    value === "hand" ||
    value === "graveyard" ||
    value === "exile" ||
    value === "library" ||
    value === "command"
    ? value
    : null;
}

function cleanPhrase(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[<>{}`]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120)
    : "";
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = cleanPhrase(value);
    const normalized = normalizePronunciationText(clean);
    if (!clean || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(clean);
  }
  return result;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function clampFraction(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(0.5, Math.max(0, value))
    : fallback;
}

function confidenceLevelForScore(score: number): AmbientConfidenceLevel {
  if (score >= 0.86) return "high";
  if (score >= 0.68) return "medium";
  if (score >= 0.42) return "low";
  return "unknown";
}
