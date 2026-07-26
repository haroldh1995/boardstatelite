import { makeId, splitGroupForQuantity, withStackKey } from "../domain/cards";
import { normalizeField } from "../domain/field";
import type { FieldState, PermanentGroup } from "../domain/types";
import { normalizeAmbientConfidence } from "./ambientConfidence";
import {
  ambientEventPipeline,
  createAmbientPreview,
} from "./ambientEventPipeline";
import type {
  AmbientConfidenceAssessment,
  AmbientConfidenceLevel,
} from "./ambientConfidenceTypes";
import type {
  AmbientEntityReference,
  AmbientFieldMutation,
  AmbientIntentInput,
} from "./ambientEventTypes";
import type { AmbientGameplayMode } from "./ambientTypes";
import {
  decideClarificationForIntent,
  normalizeClarificationSettings,
} from "./clarification";
import {
  activateListeningWindow,
  getActiveListeningWindow,
} from "./contextualListening";
import {
  createBattlefieldContext,
  resolveEchoEntity,
} from "./entityResolution";
import type {
  EchoEntityResolutionResult,
  EchoEntityKind,
} from "./entityResolutionTypes";
import {
  ECHO_COMBAT_DECLARATION_VERSION,
  type EchoCombatAttackAssignment,
  type EchoCombatAttackerReference,
  type EchoCombatDeclarationInput,
  type EchoCombatDeclarationLifecycleInput,
  type EchoCombatDeclarationPreviewInput,
  type EchoCombatDeclarationPublishInput,
  type EchoCombatDeclarationResult,
  type EchoCombatDeclarationSession,
  type EchoCombatDeclarationSessionStatus,
  type EchoCombatDeclarationSettings,
  type EchoCombatDeclarationState,
  type EchoCombatDeclarationTrigger,
  type EchoCombatDefenderReference,
  type EchoCombatGroupReferenceKind,
  type EchoCombatPreview,
  type EchoCombatClarificationRequest,
  type EchoCombatDeclarationDiagnostics,
} from "./combatDeclarationTypes";

const MAX_COMBAT_SESSIONS = 8;
const DEFAULT_CONFIDENCE_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const ELIGIBLE_EXPECTED_KINDS: EchoEntityKind[] = [
  "creature",
  "commander",
  "token",
  "tokenStack",
  "permanent",
];

const NUMBER_WORDS = new Map<string, number>([
  ["one", 1],
  ["a", 1],
  ["an", 1],
  ["single", 1],
  ["two", 2],
  ["both", 2],
  ["couple", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
]);

const COMPLETION_PHRASES = new Set([
  "thats it",
  "that is it",
  "done",
  "all done",
  "attacks done",
  "declare attacks",
  "confirm attacks",
  "send it",
]);

export function createDefaultCombatDeclarationSettings(
  input: Partial<EchoCombatDeclarationSettings> = {},
): EchoCombatDeclarationSettings {
  return {
    version: ECHO_COMBAT_DECLARATION_VERSION,
    enabled: input.enabled ?? true,
    requireDefendingPlayer: input.requireDefendingPlayer ?? true,
    defaultDefenderPolicy: input.defaultDefenderPolicy ?? "clarify",
    previewRequiresConfirmation: input.previewRequiresConfirmation ?? true,
    allowGroupDeclarations: input.allowGroupDeclarations ?? true,
    allowEverythingElse: input.allowEverythingElse ?? true,
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    developerDiagnosticsEnabled: input.developerDiagnosticsEnabled ?? false,
    lastResetAt: input.lastResetAt ?? null,
  };
}

export function normalizeCombatDeclarationSettings(
  value: unknown,
): EchoCombatDeclarationSettings {
  const defaults = createDefaultCombatDeclarationSettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoCombatDeclarationSettings>;
  return {
    ...defaults,
    enabled:
      candidate.enabled === undefined
        ? defaults.enabled
        : Boolean(candidate.enabled),
    requireDefendingPlayer:
      candidate.requireDefendingPlayer === undefined
        ? defaults.requireDefendingPlayer
        : Boolean(candidate.requireDefendingPlayer),
    defaultDefenderPolicy:
      candidate.defaultDefenderPolicy === "single-opponent-only"
        ? "single-opponent-only"
        : "clarify",
    previewRequiresConfirmation:
      candidate.previewRequiresConfirmation === undefined
        ? defaults.previewRequiresConfirmation
        : Boolean(candidate.previewRequiresConfirmation),
    allowGroupDeclarations:
      candidate.allowGroupDeclarations === undefined
        ? defaults.allowGroupDeclarations
        : Boolean(candidate.allowGroupDeclarations),
    allowEverythingElse:
      candidate.allowEverythingElse === undefined
        ? defaults.allowEverythingElse
        : Boolean(candidate.allowEverythingElse),
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    developerDiagnosticsEnabled: Boolean(candidate.developerDiagnosticsEnabled),
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
  };
}

export function createDefaultCombatDeclarationState(
  input: Partial<EchoCombatDeclarationState> = {},
): EchoCombatDeclarationState {
  return {
    version: ECHO_COMBAT_DECLARATION_VERSION,
    activeSessionId: null,
    sessions: [],
    lastPreviewId: null,
    lastCommittedSessionId: null,
    lastCancelledSessionId: null,
    ...input,
    diagnostics: createCombatDiagnostics({
      ...input.diagnostics,
      activeSessionId: input.activeSessionId ?? null,
      lastPreviewId: input.lastPreviewId ?? null,
    }),
  };
}

export function normalizeCombatDeclarationState(
  value: unknown,
  options: {
    fallbackTimestamp?: string;
    settings?: EchoCombatDeclarationSettings;
    knownGroupIds?: string[];
    allowActiveSession?: boolean;
  } = {},
): EchoCombatDeclarationState {
  const settings = normalizeCombatDeclarationSettings(options.settings);
  if (!value || typeof value !== "object") {
    return createDefaultCombatDeclarationState({
      diagnostics: createCombatDiagnostics(null),
    });
  }
  const candidate = value as Partial<EchoCombatDeclarationState>;
  const knownGroupIds = new Set(options.knownGroupIds ?? []);
  const sessions = Array.isArray(candidate.sessions)
    ? candidate.sessions
        .map((session) =>
          normalizeCombatSession(session, {
            timestamp: options.fallbackTimestamp,
            settings,
            knownGroupIds,
          }),
        )
        .filter((session): session is EchoCombatDeclarationSession =>
          Boolean(session),
        )
        .slice(-MAX_COMBAT_SESSIONS)
    : [];
  const activeSession =
    options.allowActiveSession && typeof candidate.activeSessionId === "string"
      ? (sessions.find(
          (session) =>
            session.id === candidate.activeSessionId &&
            !isTerminalCombatStatus(session.status),
        ) ?? null)
      : null;
  const safeSessions = sessions.map((session) => {
    if (activeSession?.id === session.id) return session;
    if (!isTerminalCombatStatus(session.status)) {
      return recoverCombatDeclarationSession(session, {
        timestamp: options.fallbackTimestamp,
        reason: "Combat declaration session restored without active workflow.",
        settings,
      });
    }
    return session;
  });
  return createDefaultCombatDeclarationState({
    activeSessionId: activeSession?.id ?? null,
    sessions: safeSessions,
    lastPreviewId:
      typeof candidate.lastPreviewId === "string"
        ? candidate.lastPreviewId
        : null,
    lastCommittedSessionId:
      typeof candidate.lastCommittedSessionId === "string"
        ? candidate.lastCommittedSessionId
        : null,
    lastCancelledSessionId:
      typeof candidate.lastCancelledSessionId === "string"
        ? candidate.lastCancelledSessionId
        : null,
    diagnostics: createCombatDiagnostics({
      ...(candidate.diagnostics && typeof candidate.diagnostics === "object"
        ? candidate.diagnostics
        : {}),
      activeSessionId: activeSession?.id ?? null,
      lastPreviewId:
        typeof candidate.lastPreviewId === "string"
          ? candidate.lastPreviewId
          : null,
      directBattlefieldMutation: false,
    }),
  });
}

export function startCombatDeclarationSession(
  field: FieldState,
  options: {
    timestamp?: string;
    trigger?: EchoCombatDeclarationTrigger;
    settings?: EchoCombatDeclarationSettings;
  } = {},
): EchoCombatDeclarationResult {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const settings = normalizeCombatDeclarationSettings(options.settings);
  const contextualListening = activateListeningWindow(
    field.contextualListening,
    "combatDeclaration",
    {
      timestamp,
      source:
        options.trigger === "action-strip"
          ? "action-strip"
          : options.trigger === "manual-combat"
            ? "phase"
            : "explicit-command",
      ambientMode: "combat",
      reason: "Combat declaration session started.",
    },
  );
  const activatedWindow = getActiveListeningWindow(contextualListening);
  const fallbackWindowId = makeId("listening-window");
  const listeningWindowId = activatedWindow?.id ?? fallbackWindowId;
  const session: EchoCombatDeclarationSession = {
    version: ECHO_COMBAT_DECLARATION_VERSION,
    id: makeId("echo-combat"),
    fieldSessionId: field.session.id,
    status: settings.enabled ? "declaring" : "failed",
    trigger: options.trigger ?? "voice-combat",
    ambientMode: field.ambient.currentMode,
    listeningWindowId,
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    transcript: [],
    normalizedTranscript: [],
    assignments: [],
    pendingClarificationRequests: [],
    preview: null,
    currentClarificationId: null,
    pipelineEventId: null,
    recoveryReason: settings.enabled
      ? null
      : "Combat declaration workflow is disabled.",
    accessibilityAnnouncement: settings.enabled
      ? "Combat declaration started."
      : "Combat declaration workflow unavailable.",
    directBattlefieldMutation: false,
  };
  const state = upsertCombatSession(field.combatDeclaration, session);
  return {
    state,
    session,
    window: activatedWindow,
    preview: null,
    intent: null,
    pipelineResult: null,
    event: null,
  };
}

export function captureCombatDeclarationTranscript(
  input: EchoCombatDeclarationInput,
): EchoCombatDeclarationResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const settings = normalizeCombatDeclarationSettings(input.settings);
  const normalizedTranscript = normalizeCombatText(input.transcript);
  const currentSession =
    input.session ?? activeCombatSession(input.field.combatDeclaration) ?? null;
  const start =
    currentSession ??
    startCombatDeclarationSession(input.field, {
      timestamp,
      trigger: isCombatStartPhrase(normalizedTranscript)
        ? "voice-combat"
        : "voice-attack",
      settings,
    }).session;
  if (!settings.enabled) {
    const failed = failCombatSession(
      start,
      "Combat declaration workflow is disabled.",
      timestamp,
    );
    return resultForSession(input.field, failed, null, null);
  }
  if (isCompletionPhrase(normalizedTranscript)) {
    const preview = createCombatDeclarationPreview({
      field: input.field,
      session: start,
      timestamp,
      settings,
    });
    const completed = {
      ...start,
      status: preview.clarificationRequests.length
        ? "awaitingClarification"
        : "previewReady",
      updatedAt: timestamp,
      completedAt: timestamp,
      preview,
      currentClarificationId: preview.clarificationRequests[0]?.id ?? null,
      accessibilityAnnouncement:
        preview.summary[0] ?? "Combat declaration preview ready.",
    } satisfies EchoCombatDeclarationSession;
    return resultForSession(
      input.field,
      completed,
      preview,
      createCombatDeclarationIntent(completed, preview, timestamp),
    );
  }
  if (isCombatStartPhrase(normalizedTranscript)) {
    const updated = appendCombatTranscript(start, input.transcript, timestamp);
    return resultForSession(input.field, updated, null, null);
  }

  const parsedAssignments = parseCombatAssignments({
    field: input.field,
    transcript: input.transcript,
    existingAssignments: start.assignments,
    timestamp,
    settings,
  });
  const sessionWithAssignments: EchoCombatDeclarationSession = {
    ...appendCombatTranscript(start, input.transcript, timestamp),
    status: parsedAssignments.clarifications.length
      ? "awaitingClarification"
      : "declaring",
    updatedAt: timestamp,
    assignments: [
      ...start.assignments,
      ...parsedAssignments.assignments.map((assignment, index) => ({
        ...assignment,
        order: start.assignments.length + index,
      })),
    ],
    pendingClarificationRequests: parsedAssignments.clarifications,
    currentClarificationId: parsedAssignments.clarifications[0]?.id ?? null,
    recoveryReason: parsedAssignments.error,
  };
  const preview = createCombatDeclarationPreview({
    field: input.field,
    session: sessionWithAssignments,
    timestamp,
    settings,
  });
  const sessionWithPreview: EchoCombatDeclarationSession = {
    ...sessionWithAssignments,
    status: preview.clarificationRequests.length
      ? "awaitingClarification"
      : "previewReady",
    preview,
    currentClarificationId: preview.clarificationRequests[0]?.id ?? null,
    accessibilityAnnouncement:
      preview.summary[0] ?? "Combat declaration preview ready.",
  };
  return resultForSession(
    input.field,
    sessionWithPreview,
    preview,
    createCombatDeclarationIntent(sessionWithPreview, preview, timestamp),
  );
}

export function createCombatDeclarationPreview(
  input: EchoCombatDeclarationPreviewInput,
): EchoCombatPreview {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const settings = normalizeCombatDeclarationSettings(input.settings);
  const context =
    input.context ?? createBattlefieldContext(input.field, { timestamp });
  const eligibleIds = eligibleCombatGroups(input.field).map(
    (group) => group.id,
  );
  const assignedQuantities = quantityByGroup(input.session.assignments);
  const remainingCreatureGroupIds = eligibleIds.filter(
    (groupId) => (assignedQuantities.get(groupId) ?? 0) <= 0,
  );
  const clarificationRequests = [
    ...input.session.pendingClarificationRequests,
    ...input.session.assignments.flatMap((assignment) =>
      clarificationRequestsForAssignment({
        field: input.field,
        assignment,
        timestamp,
        settings,
      }),
    ),
    ...(!input.session.assignments.length
      ? [
          createCombatClarificationRequest({
            type: "empty-declaration",
            question: "Which attackers?",
            candidateLabels: context.battlefield
              .filter((entry) => eligibleIds.includes(entry.groupId))
              .map((entry) => entry.label),
            timestamp,
          }),
        ]
      : []),
  ];
  const confidence = previewConfidence(input.session.assignments, timestamp);
  return {
    version: ECHO_COMBAT_DECLARATION_VERSION,
    id: input.session.preview?.id ?? makeId("echo-combat-preview"),
    sessionId: input.session.id,
    createdAt: input.session.preview?.createdAt ?? timestamp,
    updatedAt: timestamp,
    assignments: structuredClone(input.session.assignments),
    remainingCreatureGroupIds,
    summary: summarizeCombatDeclaration({
      assignments: input.session.assignments,
      remainingCreatureGroupIds,
    }),
    confidence,
    clarificationRequests,
    calculatesDamage: false,
    predictsBlockers: false,
    predictsOutcomes: false,
    directBattlefieldMutation: false,
  };
}

export function publishCombatDeclarationToPipeline(
  input: EchoCombatDeclarationPublishInput,
): EchoCombatDeclarationResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const preview =
    input.preview ??
    input.session.preview ??
    createCombatDeclarationPreview({
      field: input.field,
      session: input.session,
      timestamp,
      settings: input.field.settings.voice.combatDeclaration,
    });
  const intent = createCombatDeclarationIntent(
    input.session,
    preview,
    timestamp,
  );
  if (preview.clarificationRequests.length) {
    const session = {
      ...input.session,
      status: "awaitingClarification" as const,
      updatedAt: timestamp,
      preview,
      currentClarificationId: preview.clarificationRequests[0]?.id ?? null,
      accessibilityAnnouncement:
        preview.clarificationRequests[0]?.question ??
        "Combat declaration needs clarification.",
    };
    return resultForSession(input.field, session, preview, intent);
  }
  const mutation: AmbientFieldMutation = ({ field }) =>
    applyCombatDeclarationPreviewToField(
      field,
      preview,
      null,
      timestamp,
      input.session.id,
    );
  const pipelineResult = ambientEventPipeline.process({
    field: input.field,
    intent,
    mutation,
    approval: {
      method: input.approval ?? "automatic",
      decision: "approved",
      reason: "Combat declaration preview confirmed.",
    },
    previewBuilder: ({ intent: previewIntent, resolvedEntities }) =>
      createAmbientPreview({
        field: input.field,
        intent: previewIntent,
        resolvedEntities,
        timestamp,
      }),
    timestamp,
  });
  const committedSession: EchoCombatDeclarationSession = {
    ...input.session,
    status: pipelineResult.status === "completed" ? "committed" : "failed",
    updatedAt: timestamp,
    completedAt: pipelineResult.status === "completed" ? timestamp : null,
    preview,
    pipelineEventId: pipelineResult.event?.id ?? null,
    recoveryReason:
      pipelineResult.status === "completed"
        ? null
        : "Combat declaration could not be published.",
    accessibilityAnnouncement:
      pipelineResult.status === "completed"
        ? "Combat declaration committed."
        : "Combat declaration failed safely.",
  };
  return {
    state: upsertCombatSession(
      pipelineResult.status === "completed"
        ? pipelineResult.field.combatDeclaration
        : input.field.combatDeclaration,
      committedSession,
    ),
    session: committedSession,
    window: null,
    preview,
    intent,
    pipelineResult,
    event: pipelineResult.event,
  };
}

export function applyCombatDeclarationPreviewToField(
  field: FieldState,
  preview: EchoCombatPreview,
  eventId: string | null,
  timestamp = new Date().toISOString(),
  sessionId = preview.sessionId,
): FieldState {
  const assigned = quantityByGroup(preview.assignments);
  let groups = field.groups.map((group) =>
    withStackKey({
      ...group,
      statuses: {
        ...group.statuses,
        attacking: false,
      },
    }),
  );
  for (const [groupId, quantity] of assigned) {
    const group = groups.find((entry) => entry.id === groupId);
    if (!group) continue;
    if (quantity < group.quantity) {
      const split = splitGroupForQuantity(groups, groupId, quantity);
      groups = split.groups;
      if (split.targetId) {
        groups = groups.map((entry) =>
          entry.id === split.targetId
            ? withStackKey({
                ...entry,
                statuses: { ...entry.statuses, attacking: true },
              })
            : entry,
        );
      }
      continue;
    }
    groups = groups.map((entry) =>
      entry.id === groupId
        ? withStackKey({
            ...entry,
            statuses: { ...entry.statuses, attacking: true },
          })
        : entry,
    );
  }
  const baseSession =
    field.combatDeclaration.sessions.find((entry) => entry.id === sessionId) ??
    null;
  const completedSession = baseSession
    ? ({
        ...baseSession,
        status: "committed",
        updatedAt: timestamp,
        completedAt: timestamp,
        preview,
        pipelineEventId: eventId,
        accessibilityAnnouncement: "Combat declaration committed.",
      } satisfies EchoCombatDeclarationSession)
    : null;
  return normalizeField({
    ...field,
    groups,
    combatDeclaration: completedSession
      ? upsertCombatSession(field.combatDeclaration, completedSession)
      : {
          ...field.combatDeclaration,
          lastPreviewId: preview.id,
        },
  });
}

export function removeCombatDeclarationAttackers(input: {
  field: FieldState;
  session: EchoCombatDeclarationSession;
  transcript: string;
  timestamp?: string;
}): EchoCombatDeclarationSession {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const normalized = normalizeCombatText(input.transcript);
  const removalText = normalized
    .replace(/^(no|actually|remove|not)\s+/g, "")
    .replace(/^remove\s+/, "")
    .replace(/^not\s+that\s+/, "")
    .trim();
  const result = resolveEchoEntity({
    field: input.field,
    text: removalText || normalized,
    expectedKinds: ELIGIBLE_EXPECTED_KINDS,
    timestamp,
  });
  const removeGroupId = result.selected?.groupId ?? null;
  const assignments = input.session.assignments.filter((assignment) => {
    if (removeGroupId) return assignment.attacker.groupId !== removeGroupId;
    return !assignment.attacker.normalizedLabel.includes(removalText);
  });
  const preview = createCombatDeclarationPreview({
    field: input.field,
    session: { ...input.session, assignments },
    timestamp,
    settings: input.field.settings.voice.combatDeclaration,
  });
  return {
    ...input.session,
    status: preview.clarificationRequests.length
      ? "awaitingClarification"
      : "previewReady",
    updatedAt: timestamp,
    transcript: [...input.session.transcript, input.transcript],
    normalizedTranscript: [...input.session.normalizedTranscript, normalized],
    assignments,
    pendingClarificationRequests: [],
    preview,
    currentClarificationId: preview.clarificationRequests[0]?.id ?? null,
    accessibilityAnnouncement: "Combat declaration edited.",
  };
}

export function cancelCombatDeclarationSession(
  session: EchoCombatDeclarationSession,
  options: EchoCombatDeclarationLifecycleInput = {},
): EchoCombatDeclarationSession {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return {
    ...session,
    status: "cancelled",
    updatedAt: timestamp,
    completedAt: timestamp,
    currentClarificationId: null,
    recoveryReason: options.reason ?? "Combat declaration cancelled.",
    accessibilityAnnouncement: "Combat declaration cancelled.",
  };
}

export function recoverCombatDeclarationSession(
  session: EchoCombatDeclarationSession,
  options: EchoCombatDeclarationLifecycleInput = {},
): EchoCombatDeclarationSession {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return {
    ...session,
    status: "recovered",
    updatedAt: timestamp,
    currentClarificationId: null,
    recoveryReason:
      options.reason ?? "Combat declaration recovered to a safe state.",
    accessibilityAnnouncement: "Combat declaration recovered.",
  };
}

export function getCombatDeclarationDiagnostics(
  state: EchoCombatDeclarationState,
): EchoCombatDeclarationDiagnostics {
  return createCombatDiagnostics({
    ...state.diagnostics,
    activeSessionId: state.activeSessionId,
    lastPreviewId: state.lastPreviewId,
    assignmentCount:
      state.sessions.find((session) => session.id === state.activeSessionId)
        ?.assignments.length ?? 0,
  });
}

function parseCombatAssignments(input: {
  field: FieldState;
  transcript: string;
  existingAssignments: EchoCombatAttackAssignment[];
  timestamp: string;
  settings: EchoCombatDeclarationSettings;
}): {
  assignments: EchoCombatAttackAssignment[];
  clarifications: EchoCombatClarificationRequest[];
  error: string | null;
} {
  const fragments = combatFragments(input.transcript);
  const assigned = quantityByGroup(input.existingAssignments);
  const assignments: EchoCombatAttackAssignment[] = [];
  const clarifications: EchoCombatClarificationRequest[] = [];
  for (const fragment of fragments) {
    const parsed = parseCombatFragment(fragment);
    if (!parsed.attackerText) {
      clarifications.push(
        createCombatClarificationRequest({
          type: "attacker",
          question: "Which attackers?",
          candidateLabels: eligibleCombatGroups(input.field).map(
            (group) => group.label,
          ),
          timestamp: input.timestamp,
        }),
      );
      continue;
    }
    const attackerResolution = resolveCombatAttackers({
      field: input.field,
      text: parsed.attackerText,
      assigned,
      timestamp: input.timestamp,
      settings: input.settings,
    });
    clarifications.push(...attackerResolution.clarifications);
    const defender = parsed.defenderText
      ? resolveCombatDefender({
          field: input.field,
          text: parsed.defenderText,
          timestamp: input.timestamp,
          settings: input.settings,
        })
      : null;
    for (const attacker of attackerResolution.attackers) {
      const assignment = createAttackAssignment({
        attacker,
        defender,
        transcript: fragment.original,
        normalizedTranscript: fragment.normalized,
        order: assignments.length,
        timestamp: input.timestamp,
        settings: input.settings,
      });
      assignments.push(assignment);
      assigned.set(
        attacker.groupId,
        (assigned.get(attacker.groupId) ?? 0) + attacker.requestedQuantity,
      );
    }
  }
  return {
    assignments,
    clarifications,
    error: clarifications[0]?.question ?? null,
  };
}

function resolveCombatAttackers(input: {
  field: FieldState;
  text: string;
  assigned: Map<string, number>;
  timestamp: string;
  settings: EchoCombatDeclarationSettings;
}): {
  attackers: EchoCombatAttackerReference[];
  clarifications: EchoCombatClarificationRequest[];
} {
  const normalized = normalizeCombatText(input.text);
  const quantity = extractCombatQuantity(normalized);
  const special = specialCombatGroupKind(normalized);
  const eligible = eligibleCombatGroups(input.field);
  if (special) {
    const groups = eligible.filter((group) =>
      specialGroupMatches(group, special, normalized, input.assigned),
    );
    return {
      attackers: groups.map((group) =>
        attackerReferenceForGroup({
          group,
          text: input.text,
          referenceKind: special,
          requestedQuantity: requestedQuantityForGroup(
            group,
            quantity,
            special,
            input.assigned,
          ),
          timestamp: input.timestamp,
          entityResult: null,
        }),
      ),
      clarifications: groups.length
        ? []
        : [
            createCombatClarificationRequest({
              type: "attacker",
              question: "Which attackers?",
              candidateLabels: eligible.map((group) => group.label),
              timestamp: input.timestamp,
            }),
          ],
    };
  }
  const bySubtype = groupsForCreatureType(input.field, normalized);
  if (bySubtype.length) {
    return {
      attackers: bySubtype.map((group) =>
        attackerReferenceForGroup({
          group,
          text: input.text,
          referenceKind: "creatureType",
          requestedQuantity: requestedQuantityForGroup(
            group,
            quantity,
            "creatureType",
            input.assigned,
          ),
          timestamp: input.timestamp,
          entityResult: null,
        }),
      ),
      clarifications: [],
    };
  }
  const entityResult = resolveEchoEntity({
    field: input.field,
    text: input.text,
    expectedKinds: ELIGIBLE_EXPECTED_KINDS,
    role: "source",
    timestamp: input.timestamp,
    settings: input.field.settings.voice.entityResolution,
  });
  const group = entityResult.selected?.groupId
    ? input.field.groups.find(
        (entry) => entry.id === entityResult.selected?.groupId,
      )
    : null;
  if (group && isEligibleAttacker(group)) {
    return {
      attackers: [
        attackerReferenceForGroup({
          group,
          text: input.text,
          referenceKind:
            entityResult.selected?.kind === "commander"
              ? "commander"
              : "specific",
          requestedQuantity: requestedQuantityForGroup(
            group,
            quantity,
            entityResult.selected?.kind === "commander"
              ? "commander"
              : "specific",
            input.assigned,
          ),
          timestamp: input.timestamp,
          entityResult,
        }),
      ],
      clarifications: [],
    };
  }
  const decision = decideClarificationForIntent({
    field: input.field,
    intent: {
      kind: "attack",
      source: "voice-command",
      confidence: "low",
      payload: { primaryObjectText: input.text },
    },
    entityResults: [entityResult],
    transcript: input.text,
    timestamp: input.timestamp,
    settings: input.field.settings.voice.clarification,
  });
  return {
    attackers: [],
    clarifications: [
      createCombatClarificationRequest({
        type: "attacker",
        question: decision.prompt?.question ?? "Which attacker?",
        candidateLabels:
          decision.prompt?.candidateLabels ??
          entityResult.candidates.map((candidate) => candidate.label),
        frameworkDecision: decision,
        timestamp: input.timestamp,
      }),
    ],
  };
}

function resolveCombatDefender(input: {
  field: FieldState;
  text: string;
  timestamp: string;
  settings: EchoCombatDeclarationSettings;
}): EchoCombatDefenderReference {
  const normalized = normalizeCombatText(input.text);
  const singleOpponent =
    input.field.opponentValues.numberOfOpponents <= 1 &&
    input.settings.defaultDefenderPolicy === "single-opponent-only";
  const confidence = combatConfidence({
    level: singleOpponent ? "high" : normalized ? "medium" : "low",
    score: singleOpponent ? 0.96 : normalized ? 0.72 : 0.25,
    timestamp: input.timestamp,
    reasons: [
      singleOpponent
        ? "Only one opponent is configured."
        : "Defending player was recognized as local combat metadata.",
    ],
  });
  return {
    id: `defender:${normalized || "opponent"}`,
    label: titleCase(normalized || "opponent"),
    normalizedLabel: normalized || "opponent",
    owner: "opponent",
    participantId: null,
    sourceText: input.text,
    confidence,
  };
}

function createAttackAssignment(input: {
  attacker: EchoCombatAttackerReference;
  defender: EchoCombatDefenderReference | null;
  transcript: string;
  normalizedTranscript: string;
  order: number;
  timestamp: string;
  settings: EchoCombatDeclarationSettings;
}): EchoCombatAttackAssignment {
  const needsDefender =
    input.settings.requireDefendingPlayer && !input.defender;
  const lowConfidence =
    input.attacker.confidence.level === "low" ||
    input.defender?.confidence.level === "low" ||
    input.attacker.confidence.level === "unknown";
  const confidence = combatConfidence({
    level: needsDefender || lowConfidence ? "low" : "high",
    score: needsDefender || lowConfidence ? 0.35 : 0.9,
    timestamp: input.timestamp,
    reasons: [
      needsDefender
        ? "Defending player must be clarified."
        : "Attacker and defender were recognized.",
    ],
  });
  return {
    id: makeId("echo-combat-assignment"),
    order: input.order,
    attacker: input.attacker,
    defender: input.defender,
    originalTranscript: input.transcript,
    normalizedTranscript: input.normalizedTranscript,
    confidence,
    clarificationRequired: needsDefender || lowConfidence,
    clarificationQuestion: needsDefender
      ? "Which opponent?"
      : lowConfidence
        ? `Did you mean ${input.attacker.label}?`
        : null,
  };
}

function clarificationRequestsForAssignment(input: {
  field: FieldState;
  assignment: EchoCombatAttackAssignment;
  timestamp: string;
  settings: EchoCombatDeclarationSettings;
}): EchoCombatClarificationRequest[] {
  const requests: EchoCombatClarificationRequest[] = [];
  if (!input.assignment.defender && input.settings.requireDefendingPlayer) {
    requests.push(
      createCombatClarificationRequest({
        assignmentId: input.assignment.id,
        type: "defender",
        question: "Which opponent?",
        candidateLabels: inferredOpponentLabels(input.field),
        timestamp: input.timestamp,
      }),
    );
  }
  if (input.assignment.attacker.entityResult?.status === "ambiguous") {
    const decision = decideClarificationForIntent({
      field: input.field,
      intent: {
        kind: "attack",
        source: "voice-command",
        confidence: "low",
        payload: {
          primaryObjectText: input.assignment.attacker.sourceText,
        },
      },
      entityResults: [input.assignment.attacker.entityResult],
      transcript: input.assignment.originalTranscript,
      timestamp: input.timestamp,
      settings: normalizeClarificationSettings(
        input.field.settings.voice.clarification,
      ),
    });
    requests.push(
      createCombatClarificationRequest({
        assignmentId: input.assignment.id,
        type: "attacker",
        question: decision.prompt?.question ?? "Which attacker?",
        candidateLabels:
          decision.prompt?.candidateLabels ??
          input.assignment.attacker.entityResult.candidates.map(
            (candidate) => candidate.label,
          ),
        frameworkDecision: decision,
        timestamp: input.timestamp,
      }),
    );
  }
  if (
    input.assignment.attacker.requestedQuantity >
    input.assignment.attacker.availableQuantity
  ) {
    requests.push(
      createCombatClarificationRequest({
        assignmentId: input.assignment.id,
        type: "quantity",
        question: "How many?",
        candidateLabels: [
          input.assignment.attacker.availableQuantity.toString(),
        ],
        timestamp: input.timestamp,
      }),
    );
  }
  if (
    input.settings.previewRequiresConfirmation &&
    input.assignment.confidence.level === "medium"
  ) {
    requests.push(
      createCombatClarificationRequest({
        assignmentId: input.assignment.id,
        type: "confirmation",
        question: `Confirm ${input.assignment.attacker.label} attacking?`,
        candidateLabels: ["Yes", "No"],
        timestamp: input.timestamp,
      }),
    );
  }
  return requests;
}

function createCombatClarificationRequest(input: {
  assignmentId?: string | null;
  type: EchoCombatClarificationRequest["type"];
  question: string;
  candidateLabels: string[];
  frameworkDecision?: EchoCombatClarificationRequest["frameworkDecision"];
  timestamp: string;
}): EchoCombatClarificationRequest {
  return {
    id: makeId("echo-combat-clarification"),
    assignmentId: input.assignmentId ?? null,
    type: input.type,
    question: input.question,
    candidateLabels: [...input.candidateLabels].slice(0, 8),
    frameworkDecision: input.frameworkDecision ?? null,
    createdAt: input.timestamp,
  };
}

function createCombatDeclarationIntent(
  session: EchoCombatDeclarationSession,
  preview: EchoCombatPreview,
  timestamp: string,
): AmbientIntentInput {
  const entities: AmbientEntityReference[] = [];
  for (const assignment of preview.assignments) {
    entities.push({
      kind: "group",
      id: assignment.attacker.groupId,
      role: "source",
    });
    if (assignment.defender) {
      entities.push({ kind: "player", owner: "opponent", role: "target" });
    }
  }
  return {
    id: `intent-${session.id}`,
    kind: "attack",
    source: "voice-command",
    actor: "you",
    createdAt: timestamp,
    entities,
    payload: {
      combatDeclarationSessionId: session.id,
      combatPreviewId: preview.id,
      assignmentCount: preview.assignments.length,
      attackerCount: preview.assignments.reduce(
        (total, assignment) => total + assignment.attacker.requestedQuantity,
        0,
      ),
      defenderLabels: preview.assignments
        .map((assignment) => assignment.defender?.label)
        .filter(Boolean)
        .join(", "),
      calculatesDamage: false,
      predictsBlockers: false,
      predictsOutcomes: false,
    },
    confidence: preview.confidence,
    requiredMode: null,
    requiresPreview: true,
    correlationId: session.id,
  };
}

function resultForSession(
  field: FieldState,
  session: EchoCombatDeclarationSession,
  preview: EchoCombatPreview | null,
  intent: AmbientIntentInput | null,
): EchoCombatDeclarationResult {
  return {
    state: upsertCombatSession(field.combatDeclaration, session),
    session,
    window: session.listeningWindowId
      ? (getActiveListeningWindow(field.contextualListening) ?? null)
      : null,
    preview,
    intent,
    pipelineResult: null,
    event: null,
  };
}

function upsertCombatSession(
  state: EchoCombatDeclarationState,
  session: EchoCombatDeclarationSession,
): EchoCombatDeclarationState {
  const terminal = isTerminalCombatStatus(session.status);
  const sessions = [
    ...state.sessions.filter((entry) => entry.id !== session.id),
    session,
  ].slice(-MAX_COMBAT_SESSIONS);
  return createDefaultCombatDeclarationState({
    ...state,
    activeSessionId: terminal ? null : session.id,
    sessions,
    lastPreviewId: session.preview?.id ?? state.lastPreviewId,
    lastCommittedSessionId:
      session.status === "committed"
        ? session.id
        : state.lastCommittedSessionId,
    lastCancelledSessionId:
      session.status === "cancelled"
        ? session.id
        : state.lastCancelledSessionId,
    diagnostics: createCombatDiagnostics({
      activeSessionId: terminal ? null : session.id,
      lastSessionId: session.id,
      lastStatus: session.status,
      lastPreviewId: session.preview?.id ?? state.lastPreviewId,
      lastPipelineEventId: session.pipelineEventId,
      lastError: session.recoveryReason,
      assignmentCount: session.assignments.length,
      clarificationCount: session.preview?.clarificationRequests.length ?? 0,
    }),
  });
}

function activeCombatSession(
  state: EchoCombatDeclarationState,
): EchoCombatDeclarationSession | null {
  if (!state.activeSessionId) return null;
  return (
    state.sessions.find((session) => session.id === state.activeSessionId) ??
    null
  );
}

function appendCombatTranscript(
  session: EchoCombatDeclarationSession,
  transcript: string,
  timestamp: string,
): EchoCombatDeclarationSession {
  return {
    ...session,
    updatedAt: timestamp,
    transcript: [...session.transcript, transcript],
    normalizedTranscript: [
      ...session.normalizedTranscript,
      normalizeCombatText(transcript),
    ],
  };
}

function failCombatSession(
  session: EchoCombatDeclarationSession,
  reason: string,
  timestamp: string,
): EchoCombatDeclarationSession {
  return {
    ...session,
    status: "failed",
    updatedAt: timestamp,
    recoveryReason: reason,
    accessibilityAnnouncement: reason,
  };
}

function eligibleCombatGroups(field: FieldState): PermanentGroup[] {
  return field.groups.filter(isEligibleAttacker).sort((left, right) => {
    if (isCommanderCandidate(left) !== isCommanderCandidate(right)) {
      return isCommanderCandidate(left) ? -1 : 1;
    }
    return left.order - right.order || left.label.localeCompare(right.label);
  });
}

function isEligibleAttacker(group: PermanentGroup): boolean {
  return (
    group.zone === "battlefield" &&
    group.controller === "you" &&
    group.owner === "you" &&
    group.characteristics.isCreature &&
    !group.statuses.tapped &&
    !group.statuses.phasedOut &&
    group.quantity > 0
  );
}

function isCommanderCandidate(group: PermanentGroup): boolean {
  return group.characteristics.isLegendary && group.characteristics.isCreature;
}

function groupsForCreatureType(
  field: FieldState,
  text: string,
): PermanentGroup[] {
  const normalized = singularize(normalizeCombatText(text));
  if (!normalized || normalized.length < 3) return [];
  return eligibleCombatGroups(field).filter((group) =>
    group.characteristics.subtypes.some(
      (subtype) => singularize(normalizeCombatText(subtype)) === normalized,
    ),
  );
}

function attackerReferenceForGroup(input: {
  group: PermanentGroup;
  text: string;
  referenceKind: EchoCombatGroupReferenceKind;
  requestedQuantity: number;
  timestamp: string;
  entityResult: EchoEntityResolutionResult | null;
}): EchoCombatAttackerReference {
  const quantity = Math.max(
    1,
    Math.min(input.group.quantity, input.requestedQuantity),
  );
  return {
    id: `attacker:${input.group.id}:${input.referenceKind}`,
    groupId: input.group.id,
    objectIds: [...(input.group.session?.objectIds ?? [input.group.id])].slice(
      0,
      quantity,
    ),
    label: input.group.label,
    normalizedLabel: normalizeCombatText(input.group.label),
    requestedQuantity: quantity,
    availableQuantity: input.group.quantity,
    referenceKind: input.referenceKind,
    sourceText: input.text,
    confidence: combatConfidence({
      level: input.entityResult?.confidence.level ?? "high",
      score: input.entityResult?.confidence.score ?? 0.92,
      timestamp: input.timestamp,
      reasons: input.entityResult?.confidence.reasons ?? [
        `${input.referenceKind} combat reference matched.`,
      ],
    }),
    entityResult: input.entityResult,
  };
}

function requestedQuantityForGroup(
  group: PermanentGroup,
  quantity: number | null,
  kind: EchoCombatGroupReferenceKind,
  assigned: Map<string, number>,
): number {
  const remaining = Math.max(0, group.quantity - (assigned.get(group.id) ?? 0));
  if (kind === "everythingElse") return remaining || group.quantity;
  if (
    kind === "everything" ||
    kind === "tokens" ||
    kind === "untappedCreatures"
  )
    return remaining || group.quantity;
  if (quantity !== null) return Math.max(1, Math.min(quantity, group.quantity));
  if (kind === "creatureType") return remaining || group.quantity;
  return 1;
}

function specialCombatGroupKind(
  text: string,
): EchoCombatGroupReferenceKind | null {
  if (/\b(everything else|everybody else|everyone else|all else)\b/.test(text))
    return "everythingElse";
  if (
    /\b(everything|everyone|all creatures|swing team|whole team)\b/.test(text)
  )
    return "everything";
  if (/\b(all tokens|tokens|token creatures)\b/.test(text)) return "tokens";
  if (/\b(untapped creatures|all untapped|untapped team)\b/.test(text))
    return "untappedCreatures";
  if (/\b(flyers|fliers|flying creatures)\b/.test(text)) return "flyers";
  if (/\b(my commander|commander)\b/.test(text)) return "commander";
  return null;
}

function specialGroupMatches(
  group: PermanentGroup,
  kind: EchoCombatGroupReferenceKind,
  text: string,
  assigned: Map<string, number>,
): boolean {
  if (!isEligibleAttacker(group)) return false;
  if (kind === "everythingElse") {
    return (assigned.get(group.id) ?? 0) < group.quantity;
  }
  if (kind === "everything" || kind === "untappedCreatures") return true;
  if (kind === "tokens") return group.characteristics.isToken;
  if (kind === "commander") return isCommanderCandidate(group);
  if (kind === "flyers") {
    return (
      group.counters.Flying > 0 ||
      group.identity?.keywords.includes("Flying") ||
      /\bflying\b/i.test(group.identity?.oracleText ?? "")
    );
  }
  return text.length > 0;
}

function parseCombatFragment(fragment: {
  original: string;
  normalized: string;
}): { attackerText: string | null; defenderText: string | null } {
  let text = fragment.normalized
    .replace(/^i\s+/, "")
    .replace(/^(declare\s+)?(attackers|attacks)\s*/, "")
    .replace(/^(attack|attacks|swing|swings)\s+with\s+/, "")
    .replace(/^(attack|attacks|swing|swings)\s+/, "")
    .trim();
  if (!text) return { attackerText: null, defenderText: null };
  const defenderSplit = splitDefenderText(text);
  if (defenderSplit) {
    return {
      attackerText: cleanAttackerText(defenderSplit.attacker),
      defenderText: defenderSplit.defender,
    };
  }
  if (/^(at|into)\s+/.test(text)) {
    return {
      attackerText: null,
      defenderText: text.replace(/^(at|into)\s+/, "").trim(),
    };
  }
  text = cleanAttackerText(text);
  return { attackerText: text || null, defenderText: null };
}

function splitDefenderText(
  text: string,
): { attacker: string; defender: string } | null {
  const marker = /\s+(?:at|into|toward|towards)\s+/;
  const match = text.match(marker);
  if (match?.index !== undefined) {
    return {
      attacker: text.slice(0, match.index).trim(),
      defender: text.slice(match.index + match[0].length).trim(),
    };
  }
  const attacksMatch = text.match(/\s+attacks?\s+/);
  if (attacksMatch?.index !== undefined) {
    return {
      attacker: text.slice(0, attacksMatch.index).trim(),
      defender: text.slice(attacksMatch.index + attacksMatch[0].length).trim(),
    };
  }
  return null;
}

function cleanAttackerText(value: string): string {
  return value
    .replace(/^(my|the)\s+/, "")
    .replace(/\b(creatures?|attackers?)$/g, "")
    .trim();
}

function combatFragments(transcript: string): Array<{
  original: string;
  normalized: string;
}> {
  return transcript
    .split(/[,.]+|\bthen\b/gi)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((original) => ({
      original,
      normalized: normalizeCombatText(original),
    }))
    .filter((entry) => entry.normalized);
}

function extractCombatQuantity(text: string): number | null {
  const digit = text.match(/\b(\d{1,3})\b/);
  if (digit) return Number.parseInt(digit[1], 10);
  for (const [word, value] of NUMBER_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return null;
}

function quantityByGroup(
  assignments: EchoCombatAttackAssignment[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const assignment of assignments) {
    map.set(
      assignment.attacker.groupId,
      (map.get(assignment.attacker.groupId) ?? 0) +
        assignment.attacker.requestedQuantity,
    );
  }
  return map;
}

function previewConfidence(
  assignments: EchoCombatAttackAssignment[],
  timestamp: string,
): AmbientConfidenceAssessment {
  if (!assignments.length) {
    return combatConfidence({
      level: "low",
      score: 0.2,
      timestamp,
      reasons: ["No attackers have been declared."],
    });
  }
  const hasLow = assignments.some(
    (assignment) =>
      assignment.clarificationRequired || assignment.confidence.level === "low",
  );
  return combatConfidence({
    level: hasLow ? "low" : "high",
    score: hasLow ? 0.38 : 0.91,
    timestamp,
    reasons: [
      hasLow
        ? "Combat declaration needs clarification."
        : "Combat declaration is ready for preview confirmation.",
    ],
  });
}

function combatConfidence(input: {
  level: AmbientConfidenceLevel;
  score: number | null;
  timestamp: string;
  reasons: string[];
}): AmbientConfidenceAssessment {
  return normalizeAmbientConfidence(
    {
      level: input.level,
      score: input.score,
      reasons: input.reasons,
      source: "voice-command",
      assessedAt: input.timestamp || DEFAULT_CONFIDENCE_TIMESTAMP,
      validation: {
        contextValid: true,
        rulesValid: true,
        warningCount: input.level === "high" ? 0 : 1,
      },
    },
    {
      source: "voice-command",
      timestamp: input.timestamp || DEFAULT_CONFIDENCE_TIMESTAMP,
    },
  );
}

function summarizeCombatDeclaration(input: {
  assignments: EchoCombatAttackAssignment[];
  remainingCreatureGroupIds: string[];
}): string[] {
  if (!input.assignments.length) return ["No attackers declared."];
  const lines = input.assignments.map((assignment) => {
    const quantity =
      assignment.attacker.requestedQuantity > 1
        ? `${assignment.attacker.requestedQuantity} `
        : "";
    const defender = assignment.defender
      ? ` at ${assignment.defender.label}`
      : " at an unspecified opponent";
    return `${quantity}${assignment.attacker.label}${defender}.`;
  });
  if (input.remainingCreatureGroupIds.length) {
    lines.push(
      `${input.remainingCreatureGroupIds.length} creature group(s) remain back.`,
    );
  }
  return lines;
}

function inferredOpponentLabels(field: FieldState): string[] {
  const labels = field.session.participants
    .filter((participant) => !participant.local)
    .map((participant) => participant.label);
  if (labels.length) return labels;
  const count = Math.max(1, field.opponentValues.numberOfOpponents);
  return Array.from({ length: Math.min(count, 6) }, (_, index) =>
    count === 1 ? "Opponent" : `Opponent ${index + 1}`,
  );
}

function isCombatStartPhrase(text: string): boolean {
  return (
    text === "combat" ||
    text === "move to combat" ||
    text === "go to combat" ||
    text === "begin combat" ||
    text === "declare attackers"
  );
}

function isCompletionPhrase(text: string): boolean {
  return COMPLETION_PHRASES.has(text);
}

function normalizeCombatText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/['’]/g, "")
    .replace(/[^a-zA-Z0-9+/ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function singularize(value: string): string {
  return value
    .replace(
      /\b(all|both|the|my|two|three|four|five|six|seven|eight|nine|ten)\b/g,
      "",
    )
    .replace(/\b\d+\b/g, "")
    .trim()
    .replace(/ies$/g, "y")
    .replace(/s$/g, "");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeCombatSession(
  value: unknown,
  options: {
    timestamp?: string;
    settings: EchoCombatDeclarationSettings;
    knownGroupIds: Set<string>;
  },
): EchoCombatDeclarationSession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoCombatDeclarationSession>;
  const timestamp = options.timestamp ?? new Date().toISOString();
  const assignments = Array.isArray(candidate.assignments)
    ? candidate.assignments
        .map((assignment, index) =>
          normalizeAssignment(assignment, {
            timestamp,
            knownGroupIds: options.knownGroupIds,
            index,
          }),
        )
        .filter((assignment): assignment is EchoCombatAttackAssignment =>
          Boolean(assignment),
        )
    : [];
  const status = normalizeCombatStatus(candidate.status);
  return {
    version: ECHO_COMBAT_DECLARATION_VERSION,
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : makeId("echo-combat"),
    fieldSessionId:
      typeof candidate.fieldSessionId === "string"
        ? candidate.fieldSessionId
        : null,
    status,
    trigger: normalizeTrigger(candidate.trigger),
    ambientMode: normalizeMode(candidate.ambientMode),
    listeningWindowId:
      typeof candidate.listeningWindowId === "string"
        ? candidate.listeningWindowId
        : null,
    startedAt:
      typeof candidate.startedAt === "string" ? candidate.startedAt : timestamp,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : timestamp,
    completedAt:
      typeof candidate.completedAt === "string" ? candidate.completedAt : null,
    transcript: Array.isArray(candidate.transcript)
      ? candidate.transcript
          .filter((entry): entry is string => typeof entry === "string")
          .slice(-20)
      : [],
    normalizedTranscript: Array.isArray(candidate.normalizedTranscript)
      ? candidate.normalizedTranscript
          .filter((entry): entry is string => typeof entry === "string")
          .map(normalizeCombatText)
          .slice(-20)
      : [],
    assignments,
    pendingClarificationRequests: [],
    preview: normalizePreview(candidate.preview, {
      timestamp,
      knownGroupIds: options.knownGroupIds,
    }),
    currentClarificationId:
      typeof candidate.currentClarificationId === "string"
        ? candidate.currentClarificationId
        : null,
    pipelineEventId:
      typeof candidate.pipelineEventId === "string"
        ? candidate.pipelineEventId
        : null,
    recoveryReason:
      typeof candidate.recoveryReason === "string"
        ? candidate.recoveryReason
        : null,
    accessibilityAnnouncement:
      typeof candidate.accessibilityAnnouncement === "string"
        ? candidate.accessibilityAnnouncement
        : "",
    directBattlefieldMutation: false,
  };
}

function normalizeAssignment(
  value: unknown,
  options: { timestamp: string; knownGroupIds: Set<string>; index: number },
): EchoCombatAttackAssignment | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoCombatAttackAssignment>;
  const attacker = normalizeAttacker(candidate.attacker, options);
  if (!attacker) return null;
  return {
    id:
      typeof candidate.id === "string"
        ? candidate.id
        : makeId("echo-combat-assignment"),
    order:
      typeof candidate.order === "number" && Number.isFinite(candidate.order)
        ? candidate.order
        : options.index,
    attacker,
    defender: normalizeDefender(candidate.defender, options.timestamp),
    originalTranscript:
      typeof candidate.originalTranscript === "string"
        ? candidate.originalTranscript.slice(0, 240)
        : "",
    normalizedTranscript:
      typeof candidate.normalizedTranscript === "string"
        ? normalizeCombatText(candidate.normalizedTranscript)
        : "",
    confidence: normalizeAmbientConfidence(candidate.confidence ?? "low", {
      source: "voice-command",
      timestamp: options.timestamp,
    }),
    clarificationRequired: Boolean(candidate.clarificationRequired),
    clarificationQuestion:
      typeof candidate.clarificationQuestion === "string"
        ? candidate.clarificationQuestion.slice(0, 120)
        : null,
  };
}

function normalizeAttacker(
  value: unknown,
  options: { timestamp: string; knownGroupIds: Set<string> },
): EchoCombatAttackerReference | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoCombatAttackerReference>;
  if (
    typeof candidate.groupId !== "string" ||
    (options.knownGroupIds.size &&
      !options.knownGroupIds.has(candidate.groupId))
  ) {
    return null;
  }
  return {
    id:
      typeof candidate.id === "string"
        ? candidate.id
        : `attacker:${candidate.groupId}`,
    groupId: candidate.groupId,
    objectIds: Array.isArray(candidate.objectIds)
      ? candidate.objectIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    label:
      typeof candidate.label === "string"
        ? candidate.label.slice(0, 120)
        : "Attacker",
    normalizedLabel:
      typeof candidate.normalizedLabel === "string"
        ? normalizeCombatText(candidate.normalizedLabel)
        : "attacker",
    requestedQuantity: clampCount(candidate.requestedQuantity, 1, 999, 1),
    availableQuantity: clampCount(candidate.availableQuantity, 1, 999, 1),
    referenceKind: normalizeReferenceKind(candidate.referenceKind),
    sourceText:
      typeof candidate.sourceText === "string"
        ? candidate.sourceText.slice(0, 120)
        : "",
    confidence: normalizeAmbientConfidence(candidate.confidence ?? "low", {
      source: "voice-command",
      timestamp: options.timestamp,
    }),
    entityResult: null,
  };
}

function normalizeDefender(
  value: unknown,
  timestamp: string,
): EchoCombatDefenderReference | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoCombatDefenderReference>;
  const label =
    typeof candidate.label === "string" && candidate.label
      ? candidate.label.slice(0, 80)
      : "Opponent";
  return {
    id: typeof candidate.id === "string" ? candidate.id : `defender:${label}`,
    label,
    normalizedLabel:
      typeof candidate.normalizedLabel === "string"
        ? normalizeCombatText(candidate.normalizedLabel)
        : normalizeCombatText(label),
    owner: "opponent",
    participantId:
      typeof candidate.participantId === "string"
        ? candidate.participantId
        : null,
    sourceText:
      typeof candidate.sourceText === "string" ? candidate.sourceText : label,
    confidence: normalizeAmbientConfidence(candidate.confidence ?? "medium", {
      source: "voice-command",
      timestamp,
    }),
  };
}

function normalizePreview(
  value: unknown,
  options: { timestamp: string; knownGroupIds: Set<string> },
): EchoCombatPreview | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoCombatPreview>;
  const assignments = Array.isArray(candidate.assignments)
    ? candidate.assignments
        .map((assignment, index) =>
          normalizeAssignment(assignment, {
            timestamp: options.timestamp,
            knownGroupIds: options.knownGroupIds,
            index,
          }),
        )
        .filter((assignment): assignment is EchoCombatAttackAssignment =>
          Boolean(assignment),
        )
    : [];
  return {
    version: ECHO_COMBAT_DECLARATION_VERSION,
    id:
      typeof candidate.id === "string"
        ? candidate.id
        : makeId("echo-combat-preview"),
    sessionId:
      typeof candidate.sessionId === "string" ? candidate.sessionId : "",
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : options.timestamp,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : options.timestamp,
    assignments,
    remainingCreatureGroupIds: Array.isArray(
      candidate.remainingCreatureGroupIds,
    )
      ? candidate.remainingCreatureGroupIds.filter(
          (entry): entry is string =>
            typeof entry === "string" &&
            (!options.knownGroupIds.size || options.knownGroupIds.has(entry)),
        )
      : [],
    summary: Array.isArray(candidate.summary)
      ? candidate.summary.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    confidence: normalizeAmbientConfidence(candidate.confidence ?? "low", {
      source: "voice-command",
      timestamp: options.timestamp,
    }),
    clarificationRequests: [],
    calculatesDamage: false,
    predictsBlockers: false,
    predictsOutcomes: false,
    directBattlefieldMutation: false,
  };
}

function createCombatDiagnostics(
  input: Partial<EchoCombatDeclarationDiagnostics> | null | undefined,
): EchoCombatDeclarationDiagnostics {
  return {
    version: ECHO_COMBAT_DECLARATION_VERSION,
    activeSessionId: input?.activeSessionId ?? null,
    lastSessionId: input?.lastSessionId ?? null,
    lastStatus: input?.lastStatus ?? null,
    lastPreviewId: input?.lastPreviewId ?? null,
    lastPipelineEventId: input?.lastPipelineEventId ?? null,
    lastError: input?.lastError ?? null,
    assignmentCount: input?.assignmentCount ?? 0,
    clarificationCount: input?.clarificationCount ?? 0,
    directBattlefieldMutation: false,
  };
}

function normalizeCombatStatus(
  value: unknown,
): EchoCombatDeclarationSessionStatus {
  return value === "idle" ||
    value === "declaring" ||
    value === "awaitingClarification" ||
    value === "previewReady" ||
    value === "committed" ||
    value === "cancelled" ||
    value === "recovered" ||
    value === "failed"
    ? value
    : "recovered";
}

function normalizeTrigger(value: unknown): EchoCombatDeclarationTrigger {
  return value === "manual-combat" ||
    value === "action-strip" ||
    value === "voice-combat" ||
    value === "voice-attack" ||
    value === "recovery" ||
    value === "system"
    ? value
    : "system";
}

function normalizeMode(value: unknown): AmbientGameplayMode {
  return value === "preTurnPreparation" ||
    value === "activeTurn" ||
    value === "combat" ||
    value === "resolution" ||
    value === "recovery" ||
    value === "postTurn"
    ? value
    : "passive";
}

function normalizeReferenceKind(value: unknown): EchoCombatGroupReferenceKind {
  return value === "specific" ||
    value === "commander" ||
    value === "everything" ||
    value === "everythingElse" ||
    value === "creatureType" ||
    value === "tokens" ||
    value === "untappedCreatures" ||
    value === "flyers" ||
    value === "nickname"
    ? value
    : "specific";
}

function isTerminalCombatStatus(
  status: EchoCombatDeclarationSessionStatus,
): boolean {
  return (
    status === "committed" ||
    status === "cancelled" ||
    status === "recovered" ||
    status === "failed"
  );
}

function clampCount(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}
