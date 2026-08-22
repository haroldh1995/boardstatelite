import { parseCharacteristics } from "../domain/cards";
import type {
  CardIdentity,
  Characteristics,
  FieldState,
  GameEvent,
  GameEventType,
  PermanentGroup,
  Zone,
} from "../domain/types";
import {
  markActionStripPipelineResult,
  synchronizeActionStripWithPlanner,
} from "../echo/activeTurnActionStrip";
import type { ActiveTurnActionStripItem } from "../echo/activeTurnActionStripTypes";
import {
  recordConfirmedLandPlay,
  recordPlannedActionExecution,
  setPlannedActionStatus,
} from "../echo/preTurnPlanner";
import type {
  PlannedAction,
  PreparedActionMetadata,
  PreparedActionValidity,
} from "../echo/preTurnPlannerTypes";
import { monotonicNowMs } from "../platform/runtime";
import { serializeStable } from "../utils/stableSerialization";
import {
  createAthenaForecastInput,
  createForecastEnvironment,
  forecastAthenaEvent,
} from "./eventForecast";
import type {
  AthenaForecastEnvironment,
  AthenaForecastInput,
} from "./eventForecastTypes";
import { athenaPerformanceMonitor } from "./performanceOptimization";
import { processAthenaConfirmedEventWithBookkeeping } from "./triggerResolution";
import { withNextAthenaTriggerDecision } from "./decisionEngine";
import {
  ATHENA_TURN_INTENT_VERSION,
  type AthenaPreparedActionEligibility,
  type AthenaPreparedActionExecutionInput,
  type AthenaPreparedActionExecutionResult,
  type AthenaPreparedVoiceMatchInput,
  type AthenaPreparedVoiceMatchResult,
  type AthenaTurnIntentDiagnostics,
} from "./turnIntentTypes";

const BASIC_LANDS: Record<string, { subtype: string; color: string }> = {
  plains: { subtype: "Plains", color: "W" },
  island: { subtype: "Island", color: "U" },
  swamp: { subtype: "Swamp", color: "B" },
  mountain: { subtype: "Mountain", color: "R" },
  forest: { subtype: "Forest", color: "G" },
};

const PERMANENT_CARD_TYPES = new Set([
  "Artifact",
  "Battle",
  "Creature",
  "Enchantment",
  "Land",
  "Planeswalker",
]);

export class AthenaTurnIntentEngine {
  private diagnostics: AthenaTurnIntentDiagnostics = emptyDiagnostics();
  private totalConfirmationDurationMs = 0;

  revalidate(field: FieldState, timestamp = field.updatedAt): FieldState {
    const started = monotonicNowMs();
    const fingerprint = canonicalTurnStateFingerprint(field);
    let sharedForecastEnvironment: AthenaForecastEnvironment | null = null;
    const forecastEnvironment = () =>
      (sharedForecastEnvironment ??= createForecastEnvironment(field));
    if (field.preTurnPlanner.canonicalSessionVersion === null) {
      this.diagnostics.turnIntentsCreated += 1;
      this.diagnostics.preparedActionsCreated +=
        field.preTurnPlanner.actions.length;
    } else if (field.preTurnPlanner.canonicalSessionVersion !== fingerprint) {
      this.diagnostics.forecastInvalidationCount += 1;
    }
    const sessionMismatch =
      field.preTurnPlanner.sessionId !== null &&
      field.preTurnPlanner.sessionId !== field.session.id;
    const localParticipantId = field.multiplayer.registry.localParticipantId;
    const participantMismatch =
      field.preTurnPlanner.participantId !== null &&
      field.preTurnPlanner.participantId !== localParticipantId;
    let invalidated = 0;
    let forecasts = 0;
    const actions = field.preTurnPlanner.actions.map((action) => {
      if (
        action.status === "completed" ||
        action.status === "cancelled" ||
        action.status === "skipped"
      ) {
        return action;
      }
      const eligibility =
        sessionMismatch || participantMismatch
          ? staleEligibility(
              action,
              "The turn intent belongs to another session or participant.",
            )
          : evaluatePlannedAction(
              field,
              action,
              timestamp,
              fingerprint,
              forecastEnvironment,
            );
      if (
        eligibility.validity === "invalidated" ||
        eligibility.validity === "stale"
      ) {
        invalidated += 1;
      }
      if (
        eligibility.forecast ||
        eligibility.reasonCodes.includes("forecast-reused")
      ) {
        forecasts += 1;
      }
      return applyEligibilityToAction(
        field,
        action,
        eligibility,
        fingerprint,
        timestamp,
      );
    });
    const planner = {
      ...field.preTurnPlanner,
      sessionId: sessionMismatch
        ? field.preTurnPlanner.sessionId
        : field.session.id,
      participantId: participantMismatch
        ? field.preTurnPlanner.participantId
        : localParticipantId,
      canonicalSessionVersion: fingerprint,
      actions,
    };
    const strip = synchronizeActionStripWithPlanner(
      field.activeTurnActionStrip,
      {
        planner,
        ambientMode: field.ambient.currentMode,
        timestamp,
        sessionId: field.session.id,
      },
    );
    this.diagnostics.planRevalidationCount += 1;
    this.diagnostics.preparedActionsInvalidated += invalidated;
    this.diagnostics.forecastReuseCount += forecasts;
    const result = {
      ...field,
      preTurnPlanner: planner,
      activeTurnActionStrip: strip,
    };
    athenaPerformanceMonitor.recordDuration(
      "forecast-generation",
      monotonicNowMs() - started,
      {
        workUnits: actions.length,
        recordedAt: timestamp,
        enabled: field.settings.athena.developerDiagnosticsEnabled,
      },
    );
    return result;
  }

  eligibility(
    field: FieldState,
    item: ActiveTurnActionStripItem,
    timestamp = field.updatedAt,
  ): AthenaPreparedActionEligibility {
    const action = item.sourceActionId
      ? (field.preTurnPlanner.actions.find(
          (entry) => entry.id === item.sourceActionId,
        ) ?? null)
      : null;
    if (
      item.turnIntentId !== "system" &&
      item.turnIntentId !== field.preTurnPlanner.turnId
    ) {
      return itemEligibility(
        item,
        action,
        "stale",
        false,
        ["turn-identity-mismatch"],
        "The prepared action belongs to another turn.",
      );
    }
    if (action) {
      if (
        action.status === "completed" ||
        action.prepared.confirmationReceiptId
      ) {
        return itemEligibility(
          item,
          action,
          "ready",
          false,
          ["already-committed"],
          "This prepared action already committed.",
        );
      }
      return evaluatePlannedAction(
        field,
        action,
        timestamp,
        canonicalTurnStateFingerprint(field),
      );
    }
    if (item.kind === "play-planned-land") {
      return itemEligibility(
        item,
        null,
        "ready",
        field.preTurnPlanner.availableLandPlays.remaining > 0,
        field.preTurnPlanner.availableLandPlays.remaining > 0
          ? ["generic-land-slot", "confirmation-required"]
          : ["no-land-plays-remaining"],
        field.preTurnPlanner.availableLandPlays.remaining > 0
          ? "The generic planned land action is ready for confirmation."
          : "No planned land plays remain.",
      );
    }
    return itemEligibility(
      item,
      null,
      "ready",
      true,
      ["turn-transition"],
      "The turn workflow action is ready.",
    );
  }

  execute(
    input: AthenaPreparedActionExecutionInput,
  ): AthenaPreparedActionExecutionResult {
    const started = monotonicNowMs();
    const timestamp = input.timestamp ?? new Date().toISOString();
    const receiptId = confirmationReceiptId(input.field, input.item);
    const finish = (
      result: AthenaPreparedActionExecutionResult,
    ): AthenaPreparedActionExecutionResult => {
      const duration = Math.max(0, monotonicNowMs() - started);
      this.diagnostics.maximumProcessingDurationMs = Math.max(
        this.diagnostics.maximumProcessingDurationMs,
        duration,
      );
      if (result.status === "committed") {
        this.diagnostics.preparedActionsConfirmed += 1;
        this.totalConfirmationDurationMs += duration;
        this.diagnostics.averageConfirmationToCommitMs =
          this.totalConfirmationDurationMs /
          this.diagnostics.preparedActionsConfirmed;
      }
      if (result.status === "duplicate") {
        this.diagnostics.duplicateConfirmationPreventions += 1;
      }
      if (result.status === "stale") {
        this.diagnostics.staleActionRejections += 1;
      }
      if (result.status === "authority-required") {
        this.diagnostics.authorityRejections += 1;
      }
      if (input.channel === "voice") this.diagnostics.voiceConfirmations += 1;
      if (input.channel === "tap") this.diagnostics.tapConfirmations += 1;
      athenaPerformanceMonitor.recordDuration(
        "prepared-action-execution",
        duration,
        {
          recordedAt: timestamp,
          enabled: input.field.settings.athena.developerDiagnosticsEnabled,
        },
      );
      return result;
    };

    if (input.channel === "voice" && input.speakerVerified !== true) {
      return finish(
        terminalExecution(
          input,
          receiptId,
          "invalid",
          "Voice confirmation requires the enrolled speaker.",
        ),
      );
    }
    const action = input.item.sourceActionId
      ? (input.field.preTurnPlanner.actions.find(
          (entry) => entry.id === input.item.sourceActionId,
        ) ?? null)
      : null;
    if (
      input.item.status === "completed" ||
      input.item.confirmationReceiptId ||
      action?.status === "completed" ||
      action?.prepared.confirmationReceiptId
    ) {
      return finish({
        ...terminalExecution(
          input,
          receiptId,
          "duplicate",
          "The prepared action was already committed.",
        ),
        duplicatePrevented: true,
      });
    }
    const eligibility = this.eligibility(input.field, input.item, timestamp);
    if (!eligibility.executable) {
      return finish(
        terminalExecution(
          input,
          receiptId,
          executionStatusForValidity(eligibility.validity),
          eligibility.reason,
        ),
      );
    }
    if (isTurnTransition(input.item)) {
      return finish(
        terminalExecution(
          input,
          receiptId,
          input.item.kind === "move-to-combat"
            ? "combat-handoff"
            : "turn-transition",
          "The existing Echo turn workflow owns this transition.",
        ),
      );
    }
    const event = confirmedEventForItem(
      input.field,
      input.item,
      action,
      input.channel,
      timestamp,
      input.recognizedText ?? null,
    );
    if (!event) {
      return finish(
        terminalExecution(
          input,
          receiptId,
          "manual-action-required",
          "The prepared action does not have a complete structured event.",
        ),
      );
    }
    const pipeline = processAthenaConfirmedEventWithBookkeeping({
      field: input.field,
      event,
      queue: input.queue,
      timestamp,
    });
    if (pipeline.validity !== "committed" || !pipeline.rootCanonicalEvent) {
      this.diagnostics.lastPlanError = pipeline.reason;
      return finish({
        ...terminalExecution(
          input,
          receiptId,
          pipeline.validity === "invalid" ? "invalid" : "failed-safe",
          pipeline.reason,
        ),
        pipeline,
      });
    }
    const canonicalEvents = [
      pipeline.rootCanonicalEvent,
      ...(pipeline.autoResolution?.generatedCanonicalEvents ?? []),
    ];
    const eventIds = uniqueStrings(canonicalEvents.map((entry) => entry.id));
    const decisionAwareField = withNextAthenaTriggerDecision(
      pipeline.resultingField,
      pipeline.queue,
      timestamp,
    );
    let planner = decisionAwareField.preTurnPlanner;
    if (action) {
      planner = recordPlannedActionExecution(planner, action.id, {
        timestamp,
        confirmationReceiptId: receiptId,
        canonicalEventIds: eventIds,
      });
    } else if (input.item.kind === "play-planned-land") {
      planner = recordConfirmedLandPlay(planner, timestamp);
    }
    let strip = synchronizeActionStripWithPlanner(
      decisionAwareField.activeTurnActionStrip,
      {
        planner,
        ambientMode: decisionAwareField.ambient.currentMode,
        timestamp,
        sessionId: decisionAwareField.session.id,
      },
    );
    const retained = strip.items.find(
      (entry) => entry.preparedActionId === input.item.preparedActionId,
    );
    if (retained) {
      strip = markActionStripPipelineResult(strip, {
        itemId: retained.id,
        status: "completed",
        timestamp,
        eventId: pipeline.rootCanonicalEvent.id,
        failureReason: null,
      });
      strip = {
        ...strip,
        items: strip.items.map((entry) =>
          entry.id === retained.id
            ? {
                ...entry,
                confirmationReceiptId: receiptId,
                resultingCanonicalEventIds: eventIds,
                semanticDescription: semanticExecutionDescription(
                  input.item,
                  pipeline,
                ),
              }
            : entry,
        ),
      };
    } else {
      strip = {
        ...strip,
        lastPipelineEventId: pipeline.rootCanonicalEvent.id,
        lastFailureReason: null,
      };
    }
    const field = {
      ...decisionAwareField,
      updatedAt: timestamp,
      preTurnPlanner: planner,
      activeTurnActionStrip: strip,
    };
    const semanticDescription = semanticExecutionDescription(
      input.item,
      pipeline,
    );
    return finish({
      version: ATHENA_TURN_INTENT_VERSION,
      status: "committed",
      preparedActionId: input.item.preparedActionId,
      plannedActionId: input.item.sourceActionId,
      confirmationReceiptId: receiptId,
      field,
      canonicalEvents,
      canonicalEventIds: eventIds,
      pipeline,
      semanticDescription,
      accessibilityDescription: semanticDescription,
      reason: "The confirmed Real Game Action completed through Athena.",
      duplicatePrevented: false,
      directBattlefieldMutation: false,
      tutorialEvents: [
        "prepared-action-confirmed",
        ...(input.channel === "voice"
          ? (["voice-action-confirmed"] as const)
          : []),
        ...(pipeline.autoResolution?.results.some(
          (result) => result.status === "resolved",
        )
          ? (["automatic-bookkeeping-completed"] as const)
          : []),
      ],
    });
  }

  reconcileCanonicalAction(
    field: FieldState,
    event: GameEvent,
    timestamp = field.updatedAt,
  ): FieldState {
    if (event.metadata.correctionOnly === true) return field;
    const preparedActionId =
      typeof event.metadata.preparedActionId === "string"
        ? event.metadata.preparedActionId
        : null;
    const planned = field.preTurnPlanner.actions.filter(
      (action) => action.status === "planned",
    );
    const direct = preparedActionId
      ? (planned.find(
          (action) => action.prepared.preparedActionId === preparedActionId,
        ) ?? null)
      : null;
    const matching =
      direct ?? planned.find((action) => actionMatchesEvent(action, event));
    let planner = field.preTurnPlanner;
    if (matching) {
      planner = recordPlannedActionExecution(planner, matching.id, {
        timestamp,
        confirmationReceiptId: `observed:${event.id}`,
        canonicalEventIds: [event.id],
      });
      if (matching.type === "land-play" && event.quantity > 1) {
        planner = recordConfirmedLandPlay(
          planner,
          timestamp,
          event.quantity - 1,
        );
      }
    } else if (event.type === "land-entered") {
      const divergentLand = planned.find(
        (action) => action.type === "land-play" && !isGenericLandAction(action),
      );
      if (divergentLand) {
        planner = setPlannedActionStatus(
          planner,
          divergentLand.id,
          "diverged",
          timestamp,
        );
        this.diagnostics.preparedActionsDiverged += 1;
      }
      planner = recordConfirmedLandPlay(planner, timestamp, event.quantity);
    } else {
      return field;
    }
    this.diagnostics.unexpectedActionsDuringPlan += direct ? 0 : 1;
    return this.revalidate(
      {
        ...field,
        preTurnPlanner: planner,
      },
      timestamp,
    );
  }

  matchVoice(
    input: AthenaPreparedVoiceMatchInput,
  ): AthenaPreparedVoiceMatchResult {
    if (!input.speakerVerified) {
      return {
        itemId: null,
        preparedActionId: null,
        accepted: false,
        reason: "The enrolled speaker was not verified.",
      };
    }
    const transcript = normalizeName(input.transcript);
    const candidates = input.field.activeTurnActionStrip.items
      .filter(
        (item) =>
          item.intentKind === input.intentKind &&
          (item.status === "pending" || item.status === "current"),
      )
      .map((item) => ({ item, score: voiceMatchScore(transcript, item) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.item.order - right.item.order,
      );
    const match = candidates[0]?.item ?? null;
    return {
      itemId: match?.id ?? null,
      preparedActionId: match?.preparedActionId ?? null,
      accepted: Boolean(match),
      reason: match
        ? "Verified Echo intent matched a prepared action."
        : "No prepared action matched the verified Echo intent.",
    };
  }

  getDiagnostics(): AthenaTurnIntentDiagnostics {
    return { ...this.diagnostics };
  }

  resetDiagnostics(): void {
    this.diagnostics = emptyDiagnostics();
    this.totalConfirmationDurationMs = 0;
  }
}

export const athenaTurnIntentEngine = new AthenaTurnIntentEngine();

export function revalidateAthenaTurnIntent(
  field: FieldState,
  timestamp = field.updatedAt,
): FieldState {
  return athenaTurnIntentEngine.revalidate(field, timestamp);
}

export function executeAthenaPreparedAction(
  input: AthenaPreparedActionExecutionInput,
): AthenaPreparedActionExecutionResult {
  return athenaTurnIntentEngine.execute(input);
}

export function matchAthenaPreparedActionForVoice(
  input: AthenaPreparedVoiceMatchInput,
): AthenaPreparedVoiceMatchResult {
  return athenaTurnIntentEngine.matchVoice(input);
}

export function reconcileAthenaTurnIntentWithCanonicalAction(
  field: FieldState,
  event: GameEvent,
  timestamp = field.updatedAt,
): FieldState {
  return athenaTurnIntentEngine.reconcileCanonicalAction(
    field,
    event,
    timestamp,
  );
}

export function createBasicLandIdentity(name: string): CardIdentity | null {
  const normalized = normalizeName(name).replace(/^play /, "");
  const definition = BASIC_LANDS[normalized];
  if (!definition) return null;
  return {
    cardId: `basic-land:${normalized}`,
    name: definition.subtype,
    manaCost: "",
    manaValue: 0,
    typeLine: `Basic Land - ${definition.subtype}`,
    oracleText: "",
    imageUrl: "",
    imageSmall: "",
    imageArt: "",
    colors: [],
    colorIdentity: [definition.color],
    keywords: [],
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    isToken: false,
    cardFaces: [],
    supportStatus: "fully-automated",
  };
}

export function canonicalTurnStateFingerprint(field: FieldState): string {
  return stableHash(
    serializeStable({
      sessionId: field.session.id,
      authority: field.session.currentSessionAuthority,
      player: field.player,
      groups: field.groups.map((group) => ({
        id: group.id,
        cardId: group.identity?.cardId ?? null,
        quantity: group.quantity,
        zone: group.zone,
        controller: group.controller,
        counters: group.counters,
        tapped: group.statuses.tapped,
        transformed: group.statuses.transformed,
        trackingEnabled: group.trackingEnabled,
        depowerMode: group.depowerMode,
        disabledAbilities: group.disabledAbilities,
        attachedTo: group.attachedTo,
        attachments: group.attachments,
      })),
      zones: field.zoneCompositions,
    }),
  );
}

function evaluatePlannedAction(
  field: FieldState,
  action: PlannedAction,
  timestamp: string,
  fingerprint: string,
  forecastEnvironment: () => AthenaForecastEnvironment = () =>
    createForecastEnvironment(field),
): AthenaPreparedActionEligibility {
  if (action.type === "land-play") {
    const plannedLands = field.preTurnPlanner.actions
      .filter(
        (entry) =>
          entry.type === "land-play" &&
          (entry.status === "planned" || entry.status === "invalidated"),
      )
      .sort((left, right) => left.order - right.order);
    if (
      plannedLands.findIndex((entry) => entry.id === action.id) >=
      field.preTurnPlanner.availableLandPlays.remaining
    ) {
      return itemEligibilityFromAction(
        action,
        "invalidated",
        false,
        ["no-planned-land-slot"],
        "No Available Land Play remains for this prepared land.",
      );
    }
  }
  const unavailableSource = sourceUnavailableReason(field, action);
  if (unavailableSource) {
    return itemEligibilityFromAction(
      action,
      "invalidated",
      false,
      [unavailableSource.code],
      unavailableSource.reason,
    );
  }
  if (action.execution.support === "authority") {
    return itemEligibilityFromAction(
      action,
      "authority-required",
      false,
      ["boardstate-authority-required"],
      "BoardState authority is required for this prepared action.",
    );
  }
  if (action.execution.support === "unsupported") {
    return itemEligibilityFromAction(
      action,
      "unsupported",
      false,
      ["unsupported-structured-action"],
      "This prepared action is not supported by Lite.",
    );
  }
  const requirement = missingRequirement(action);
  if (requirement) {
    return itemEligibilityFromAction(
      action,
      requirement.validity,
      false,
      [requirement.code],
      requirement.reason,
    );
  }
  if (action.execution.support === "manual") {
    return itemEligibilityFromAction(
      action,
      "manual-action-required",
      false,
      ["manual-resolution-required"],
      "This prepared action requires the existing manual workflow.",
    );
  }
  if (action.type === "spell-sequence" && !knownCardForAction(field, action)) {
    return itemEligibilityFromAction(
      action,
      "manual-action-required",
      false,
      ["card-identity-required"],
      "Identify the planned card before confirming it.",
    );
  }
  if (
    action.type === "land-play" &&
    !knownCardForAction(field, action) &&
    !isGenericLandAction(action)
  ) {
    return itemEligibilityFromAction(
      action,
      "manual-action-required",
      false,
      ["land-identity-required"],
      "Use the generic land action or identify the planned land.",
    );
  }
  if (
    action.prepared.canonicalStateFingerprint === fingerprint &&
    action.prepared.forecastReference &&
    (action.prepared.validity === "ready" ||
      action.prepared.validity === "awaiting-confirmation")
  ) {
    return itemEligibilityFromAction(
      action,
      action.prepared.validity,
      true,
      ["confirmed-action-required", "forecast-current", "forecast-reused"],
      "The prepared action and its forecast remain current.",
    );
  }
  const environment = forecastEnvironment();
  const draft = forecastEventForAction(
    field,
    action,
    timestamp,
    fingerprint,
    environment,
  );
  if (!draft) {
    return itemEligibilityFromAction(
      action,
      "manual-action-required",
      false,
      ["structured-event-incomplete"],
      "The prepared action does not have a complete structured event.",
    );
  }
  const forecast = forecastAthenaEvent(environment, draft, {
    timestamp,
    maxDepth: 2,
  });
  if (forecast.validity !== "valid") {
    return {
      ...itemEligibilityFromAction(
        action,
        forecast.validity === "stale" ? "stale" : "invalidated",
        false,
        ["forecast-rejected"],
        forecast.semanticDescriptions[0] ??
          "The action forecast is not current.",
      ),
      forecast,
    };
  }
  const validity: PreparedActionValidity =
    action.prepared.confidence === "inferred-low-confidence"
      ? "awaiting-confirmation"
      : "ready";
  return {
    ...itemEligibilityFromAction(
      action,
      validity,
      true,
      ["confirmed-action-required", "forecast-current"],
      "The prepared action is ready for one-press confirmation.",
    ),
    forecast,
  };
}

function forecastEventForAction(
  field: FieldState,
  action: PlannedAction,
  timestamp: string,
  fingerprint: string,
  environment: AthenaForecastEnvironment,
): AthenaForecastInput | null {
  return eventForAction(field, action, {
    eventId: `planned-event:${action.prepared.preparedActionId}:${fingerprint}`,
    eventSource: "planner",
    authoritySource: "project-echo-planned-action",
    timestamp,
    hypothetical: true,
    actionStripReference: null,
    speakerVerified: null,
    environment,
  });
}

function confirmedEventForItem(
  field: FieldState,
  item: ActiveTurnActionStripItem,
  action: PlannedAction | null,
  channel: AthenaPreparedActionExecutionInput["channel"],
  timestamp: string,
  recognizedText: string | null,
): AthenaForecastInput | null {
  if (!action && item.kind === "draw") {
    const environment = createForecastEnvironment(field);
    return createAthenaForecastInput(
      {
        eventId: item.expectedCanonicalEventId,
        eventCategory: "cards-drawn",
        eventSource: channel === "voice" ? "echo-reported" : "manual-report",
        authoritySource:
          channel === "voice"
            ? "project-echo-voice-report"
            : "confirmed-user-report",
        timestamp,
        sequence: stableSequence(item.preparedActionId),
        batchId: item.preparedActionId,
        quantity: drawQuantity(recognizedText),
        zoneOrigin: "library",
        zoneDestination: "hand",
        actionStripReference: item.id,
        metadata: {
          confirmed: true,
          canonicalEvent: true,
          hypothetical: false,
          preparedActionId: item.preparedActionId,
          label: "Draw",
          confirmationChannel: channel,
        },
        confidence: {
          level: "high",
          score: 1,
          speakerVerified: channel === "voice" ? true : null,
        },
      },
      environment,
    );
  }
  if (!action && item.kind === "play-planned-land") {
    const environment = createForecastEnvironment(field);
    const spokenBasic = recognizedText
      ? createBasicLandIdentity(recognizedText)
      : null;
    return createAthenaForecastInput(
      {
        eventId: item.expectedCanonicalEventId,
        eventCategory: "land-entered",
        eventSource:
          channel === "voice"
            ? "echo-reported"
            : channel === "sync-replay"
              ? "imported-event"
              : "manual-report",
        authoritySource:
          channel === "voice"
            ? "project-echo-voice-report"
            : channel === "sync-replay"
              ? "imported-canonical-event"
              : "confirmed-user-report",
        timestamp,
        sequence: stableSequence(item.preparedActionId),
        batchId: item.preparedActionId,
        quantity: 1,
        knownCharacteristics: spokenBasic
          ? parseCharacteristics(spokenBasic.typeLine, spokenBasic)
          : { cardTypes: ["Land"] },
        permanentDefinition: spokenBasic,
        zoneDestination: "battlefield",
        actionStripReference: item.id,
        metadata: {
          confirmed: true,
          canonicalEvent: true,
          hypothetical: false,
          preparedActionId: item.preparedActionId,
          label: spokenBasic?.name ?? "Generic Land",
          confirmationChannel: channel,
        },
        confidence: {
          level: "high",
          score: 1,
          speakerVerified: channel === "voice" ? true : null,
        },
      },
      environment,
    );
  }
  if (!action) return null;
  return eventForAction(field, action, {
    eventId: item.expectedCanonicalEventId,
    eventSource:
      channel === "voice"
        ? "echo-reported"
        : channel === "sync-replay"
          ? "imported-event"
          : "manual-report",
    authoritySource:
      channel === "voice"
        ? "project-echo-voice-report"
        : channel === "sync-replay"
          ? "imported-canonical-event"
          : "confirmed-user-report",
    timestamp,
    hypothetical: false,
    actionStripReference: item.id,
    speakerVerified: channel === "voice" ? true : null,
  });
}

function eventForAction(
  field: FieldState,
  action: PlannedAction,
  options: {
    eventId: string;
    eventSource: AthenaForecastInput["eventSource"];
    authoritySource: AthenaForecastInput["authoritySource"];
    timestamp: string;
    hypothetical: boolean;
    actionStripReference: string | null;
    speakerVerified: boolean | null;
    environment?: AthenaForecastEnvironment;
  },
): AthenaForecastInput | null {
  const environment = options.environment ?? createForecastEnvironment(field);
  const card = knownCardForAction(field, action);
  const sourceGroup = sourceGroupForAction(field, action);
  const targetGroupIds = targetGroupsForAction(field, action, sourceGroup);
  const category = eventCategoryForAction(action, card);
  if (!category) return null;
  const characteristics = card
    ? parseCharacteristics(card.typeLine, card)
    : (sourceGroup?.characteristics ??
      (action.type === "land-play" ? genericLandCharacteristics() : null));
  const isEntry =
    category === "land-entered" ||
    category === "creature-entered" ||
    category === "permanent-entered";
  const existingEntryGroup =
    isEntry && sourceGroup && sourceGroup.zone !== "battlefield"
      ? sourceGroup
      : null;
  const quantity = Math.max(1, action.quantity);
  const token = action.execution.token;
  return createAthenaForecastInput(
    {
      eventId: options.eventId,
      eventCategory: category,
      eventSource: options.eventSource,
      authoritySource: options.authoritySource,
      timestamp: options.timestamp,
      sequence: stableSequence(action.prepared.preparedActionId),
      batchId: action.prepared.preparedActionId,
      sourceObjectId:
        action.type === "activated-ability" ? action.relatedGroupId : null,
      subjectGroupIds: existingEntryGroup
        ? [existingEntryGroup.id]
        : targetGroupIds,
      quantity,
      knownCharacteristics: characteristics,
      permanentDefinition: isEntry && !existingEntryGroup ? card : null,
      tokenDefinition:
        category === "token-created" && token
          ? {
              id: `planned-token:${normalizeName(token.name)}`,
              name: token.name,
              power: token.power,
              toughness: token.toughness,
              characteristics: {
                cardTypes: uniqueStrings([...token.cardTypes, "Creature"]),
                supertypes: [],
                subtypes: [...token.subtypes],
                colors: [...token.colors],
                manaValue: 0,
                isToken: true,
                isCreature: true,
                isLegendary: false,
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
            }
          : null,
      counterType: action.execution.counterType,
      zoneOrigin:
        action.execution.originZone ??
        existingEntryGroup?.zone ??
        (category === "permanent-sacrificed" ? "battlefield" : null),
      zoneDestination:
        action.execution.destinationZone ?? destinationForEvent(category),
      plannerReference: action.id,
      actionStripReference: options.actionStripReference,
      metadata: {
        confirmed: !options.hypothetical,
        canonicalEvent: !options.hypothetical,
        hypothetical: options.hypothetical,
        preparedActionId: action.prepared.preparedActionId,
        title: action.title,
        label: card?.name ?? action.title,
        tapped: token?.tapped ?? false,
        attacking: token?.attacking ?? false,
      },
      confidence: {
        level:
          action.prepared.confidence === "inferred-low-confidence"
            ? "medium"
            : "high",
        score:
          action.prepared.confidence === "inferred-low-confidence" ? 0.72 : 1,
        speakerVerified: options.speakerVerified,
      },
    },
    environment,
  );
}

function eventCategoryForAction(
  action: PlannedAction,
  card: CardIdentity | null,
): GameEventType | null {
  if (action.type === "land-play") return "land-entered";
  if (action.type === "spell-sequence") {
    if (!card) return null;
    const characteristics = parseCharacteristics(card.typeLine, card);
    if (characteristics.cardTypes.includes("Land")) return "land-entered";
    if (characteristics.isCreature) return "creature-entered";
    if (
      characteristics.cardTypes.some((type) => PERMANENT_CARD_TYPES.has(type))
    ) {
      return "permanent-entered";
    }
    return "spell-cast";
  }
  return action.execution.eventCategory;
}

function destinationForEvent(category: GameEventType): Zone | null {
  if (
    category === "land-entered" ||
    category === "creature-entered" ||
    category === "permanent-entered" ||
    category === "permanent-returned-to-battlefield"
  ) {
    return "battlefield";
  }
  if (category === "permanent-died" || category === "permanent-sacrificed") {
    return "graveyard";
  }
  if (category === "permanent-exiled") return "exile";
  if (category === "permanent-returned-to-hand") return "hand";
  return null;
}

function sourceGroupForAction(
  field: FieldState,
  action: PlannedAction,
): PermanentGroup | null {
  if (action.relatedGroupId) {
    return (
      field.groups.find((group) => group.id === action.relatedGroupId) ?? null
    );
  }
  if (action.type === "sacrifice") {
    const name = normalizeName(action.title)
      .replace(/^sac(rifice)? /, "")
      .replace(/ x\d+$/, "");
    return (
      field.groups.find(
        (group) =>
          group.zone === "battlefield" &&
          normalizeName(group.label).includes(name),
      ) ?? null
    );
  }
  if (
    action.type === "land-play" ||
    action.type === "spell-sequence" ||
    action.type === "zone-movement"
  ) {
    const card = knownCardForAction(field, action);
    if (!card) return null;
    const origin = action.execution.originZone;
    return (
      field.groups.find(
        (group) =>
          group.identity?.cardId === card.cardId &&
          group.zone !== "battlefield" &&
          (!origin || group.zone === origin),
      ) ?? null
    );
  }
  return null;
}

function targetGroupsForAction(
  field: FieldState,
  action: PlannedAction,
  source: PermanentGroup | null,
): string[] {
  if (action.execution.targetGroupIds.length > 0) {
    return uniqueStrings(action.execution.targetGroupIds);
  }
  if (
    action.type === "sacrifice" ||
    action.type === "activated-ability" ||
    action.type === "counter-placement" ||
    action.type === "zone-movement"
  ) {
    const id = action.relatedGroupId ?? source?.id ?? null;
    return id && field.groups.some((group) => group.id === id) ? [id] : [];
  }
  return [];
}

function knownCardForAction(
  field: FieldState,
  action: PlannedAction,
): CardIdentity | null {
  if (action.cardSnapshot) return cloneCard(action.cardSnapshot);
  if (action.relatedCardId) {
    const card = [
      ...field.recentCards,
      ...field.groups.flatMap((group) =>
        group.identity ? [group.identity] : [],
      ),
    ].find((entry) => entry.cardId === action.relatedCardId);
    if (card) return cloneCard(card);
  }
  const requestedName = plannedCardName(action);
  const basic = createBasicLandIdentity(requestedName);
  if (basic) return basic;
  const card = [
    ...field.recentCards,
    ...field.groups.flatMap((group) =>
      group.identity ? [group.identity] : [],
    ),
  ].find((entry) => normalizeName(entry.name) === normalizeName(requestedName));
  return card ? cloneCard(card) : null;
}

function plannedCardName(action: PlannedAction): string {
  return (
    action.land?.primary || action.title.replace(/^(play|cast)\s+/i, "").trim()
  );
}

function isGenericLandAction(action: PlannedAction): boolean {
  const name = normalizeName(plannedCardName(action));
  return (
    !name ||
    name === "land" ||
    name === "land play" ||
    name === "generic land" ||
    name === "generic lands"
  );
}

function sourceUnavailableReason(
  field: FieldState,
  action: PlannedAction,
): { code: string; reason: string } | null {
  const needsBattlefieldSource =
    action.type === "sacrifice" ||
    action.type === "activated-ability" ||
    action.type === "counter-placement" ||
    (action.type === "planned-attack" && Boolean(action.relatedGroupId));
  if (!needsBattlefieldSource) return null;
  const source = sourceGroupForAction(field, action);
  if (!source || source.zone !== "battlefield") {
    return {
      code: "source-left-battlefield",
      reason: "The prepared action source is no longer on the battlefield.",
    };
  }
  if (action.type === "sacrifice" && source.quantity < action.quantity) {
    return {
      code: "insufficient-group-quantity",
      reason: "The grouped permanent no longer has the planned quantity.",
    };
  }
  if (action.type === "activated-ability") {
    if (source.isGeneric && !source.identity) {
      return {
        code: "generic-source-has-no-structured-ability",
        reason: "Generic placeholders do not provide invented abilities.",
      };
    }
    if (!source.trackingEnabled) {
      return {
        code: "ability-source-not-tracked",
        reason: "The prepared ability source is Not Tracked.",
      };
    }
    if (source.depowerMode === "all" || !source.abilitiesActive) {
      return {
        code: "ability-depowered",
        reason: "The prepared ability is currently Depowered.",
      };
    }
    if (
      action.prepared.sourceFaceCardId &&
      source.identity?.cardId !== action.prepared.sourceFaceCardId
    ) {
      return {
        code: "source-face-changed",
        reason: "The source transformed and the old-face ability is stale.",
      };
    }
  }
  return null;
}

function missingRequirement(
  action: PlannedAction,
): { validity: PreparedActionValidity; code: string; reason: string } | null {
  const requirements = new Set(action.execution.requirements);
  if (
    requirements.has("target") &&
    action.execution.targetGroupIds.length === 0
  ) {
    return {
      validity: "awaiting-target",
      code: "target-required",
      reason: "Choose a target before confirming this action.",
    };
  }
  if (requirements.has("mode") && !action.execution.mode) {
    return {
      validity: "awaiting-mode",
      code: "mode-required",
      reason: "Choose a mode before confirming this action.",
    };
  }
  if (requirements.has("quantity") && action.execution.quantity <= 0) {
    return {
      validity: "awaiting-quantity",
      code: "quantity-required",
      reason: "Choose a quantity before confirming this action.",
    };
  }
  if (requirements.has("selection")) {
    return {
      validity: "awaiting-selection",
      code: "selection-required",
      reason: "Choose the required object before confirming this action.",
    };
  }
  if (requirements.has("order")) {
    return {
      validity: "awaiting-order",
      code: "ordering-required",
      reason: "Confirm the required ordering before this action executes.",
    };
  }
  if (requirements.has("authority")) {
    return {
      validity: "authority-required",
      code: "boardstate-authority-required",
      reason: "BoardState authority is required for this action.",
    };
  }
  if (requirements.has("manual-resolution")) {
    return {
      validity: "manual-action-required",
      code: "manual-resolution-required",
      reason: "This action requires manual resolution.",
    };
  }
  return null;
}

function applyEligibilityToAction(
  field: FieldState,
  action: PlannedAction,
  eligibility: AthenaPreparedActionEligibility,
  fingerprint: string,
  timestamp: string,
): PlannedAction {
  const forecast = eligibility.forecast;
  const reusedForecast =
    eligibility.reasonCodes.includes("forecast-reused") &&
    action.prepared.canonicalStateFingerprint === fingerprint;
  const replacementReferences =
    forecast?.replacementRelationships.map((entry) => entry.id) ??
    (reusedForecast ? action.prepared.expectedReplacementReferences : []);
  const triggerSummary =
    forecast?.triggerRelationships.map((entry) => entry.description) ??
    (reusedForecast ? action.prepared.expectedTriggerSummary : []);
  const bookkeeping = [
    ...(forecast?.directConsequences.map((entry) => entry.description) ?? []),
    ...(forecast?.potentialGeneratedEvents.map((entry) => entry.description) ??
      []),
  ];
  const status =
    action.status === "diverged"
      ? "diverged"
      : eligibility.validity === "invalidated" ||
          eligibility.validity === "stale"
        ? "invalidated"
        : action.status === "invalidated"
          ? "planned"
          : action.status;
  const source = sourceGroupForAction(field, action);
  const prepared: PreparedActionMetadata = {
    ...action.prepared,
    validity: status === "diverged" ? "diverged" : eligibility.validity,
    canonicalStateFingerprint: fingerprint,
    forecastReference:
      forecast?.id ??
      (reusedForecast ? action.prepared.forecastReference : null),
    expectedReplacementReferences: uniqueStrings(replacementReferences),
    expectedTriggerSummary: uniqueStrings(triggerSummary),
    expectedBookkeeping: uniqueStrings(
      reusedForecast && bookkeeping.length === 0
        ? action.prepared.expectedBookkeeping
        : bookkeeping,
    ),
    reasonCodes: uniqueStrings(eligibility.reasonCodes),
    authorityRequired: eligibility.validity === "authority-required",
    manualActionRequired: eligibility.validity === "manual-action-required",
    sourceFaceCardId:
      action.prepared.sourceFaceCardId ?? source?.identity?.cardId ?? null,
  };
  return {
    ...action,
    status,
    updatedAt:
      serializeStable(action.prepared) === serializeStable(prepared)
        ? action.updatedAt
        : timestamp,
    prepared,
  };
}

function staleEligibility(
  action: PlannedAction,
  reason: string,
): AthenaPreparedActionEligibility {
  return itemEligibilityFromAction(
    action,
    "stale",
    false,
    ["session-mismatch"],
    reason,
  );
}

function itemEligibilityFromAction(
  action: PlannedAction,
  validity: PreparedActionValidity,
  executable: boolean,
  reasonCodes: string[],
  reason: string,
): AthenaPreparedActionEligibility {
  return {
    version: ATHENA_TURN_INTENT_VERSION,
    preparedActionId: action.prepared.preparedActionId,
    plannedActionId: action.id,
    validity,
    executable,
    reasonCodes,
    reason,
    action,
    forecast: null,
  };
}

function itemEligibility(
  item: ActiveTurnActionStripItem,
  action: PlannedAction | null,
  validity: PreparedActionValidity,
  executable: boolean,
  reasonCodes: string[],
  reason: string,
): AthenaPreparedActionEligibility {
  return {
    version: ATHENA_TURN_INTENT_VERSION,
    preparedActionId: item.preparedActionId,
    plannedActionId: item.sourceActionId,
    validity,
    executable,
    reasonCodes,
    reason,
    action,
    forecast: null,
  };
}

function terminalExecution(
  input: AthenaPreparedActionExecutionInput,
  confirmationReceipt: string,
  status: AthenaPreparedActionExecutionResult["status"],
  reason: string,
): AthenaPreparedActionExecutionResult {
  return {
    version: ATHENA_TURN_INTENT_VERSION,
    status,
    preparedActionId: input.item.preparedActionId,
    plannedActionId: input.item.sourceActionId,
    confirmationReceiptId: confirmationReceipt,
    field: input.field,
    canonicalEvents: [],
    canonicalEventIds: [],
    pipeline: null,
    semanticDescription: reason,
    accessibilityDescription: reason,
    reason,
    duplicatePrevented: false,
    directBattlefieldMutation: false,
    tutorialEvents: [],
  };
}

function actionMatchesEvent(action: PlannedAction, event: GameEvent): boolean {
  const label =
    typeof event.metadata.label === "string"
      ? normalizeName(event.metadata.label)
      : "";
  if (action.type === "land-play" && event.type === "land-entered") {
    return (
      isGenericLandAction(action) ||
      normalizeName(plannedCardName(action)) === label
    );
  }
  if (
    action.type === "spell-sequence" &&
    (event.type === "spell-cast" ||
      event.type === "permanent-entered" ||
      event.type === "creature-entered")
  ) {
    return normalizeName(plannedCardName(action)) === label;
  }
  if (action.type === "sacrifice" && event.type === "permanent-sacrificed") {
    return Boolean(
      action.relatedGroupId && event.groupIds.includes(action.relatedGroupId),
    );
  }
  return false;
}

function executionStatusForValidity(
  validity: PreparedActionValidity,
): AthenaPreparedActionExecutionResult["status"] {
  if (
    validity === "awaiting-target" ||
    validity === "awaiting-quantity" ||
    validity === "awaiting-mode" ||
    validity === "awaiting-selection" ||
    validity === "awaiting-order" ||
    validity === "awaiting-confirmation" ||
    validity === "prepared"
  ) {
    return "awaiting-input";
  }
  if (validity === "authority-required") return "authority-required";
  if (validity === "manual-action-required") return "manual-action-required";
  if (validity === "unsupported") return "unsupported";
  if (validity === "stale" || validity === "diverged") return "stale";
  return "invalid";
}

function semanticExecutionDescription(
  item: ActiveTurnActionStripItem,
  pipeline: NonNullable<AthenaPreparedActionExecutionResult["pipeline"]>,
): string {
  const bookkeeping = pipeline.autoResolution?.semanticDescription;
  return bookkeeping
    ? `Action completed. ${item.label}. ${bookkeeping}`
    : `Action completed. ${item.label}.`;
}

function isTurnTransition(item: ActiveTurnActionStripItem): boolean {
  return (
    item.kind === "begin-turn" ||
    item.kind === "move-to-combat" ||
    item.kind === "declare-planned-attack" ||
    item.kind === "end-combat" ||
    item.kind === "end-turn" ||
    item.kind === "pass-priority" ||
    item.kind === "second-main-reminder" ||
    item.kind === "hold-priority-reminder" ||
    item.kind === "resolve-planned-trigger"
  );
}

function drawQuantity(recognizedText: string | null): number {
  if (!recognizedText) return 1;
  const normalized = normalizeName(recognizedText);
  const numeric = normalized.match(/\b(\d{1,3})\b/);
  if (numeric) return Math.max(1, Math.min(999, Number(numeric[1])));
  const words: Record<string, number> = {
    a: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  for (const [word, quantity] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) return quantity;
  }
  return 1;
}

function confirmationReceiptId(
  field: FieldState,
  item: ActiveTurnActionStripItem,
): string {
  return `prepared-receipt:${stableHash(
    `${field.session.id}:${item.turnIntentId}:${item.preparedActionId}`,
  )}`;
}

function voiceMatchScore(
  transcript: string,
  item: ActiveTurnActionStripItem,
): number {
  const label = normalizeName(item.label);
  const detail = normalizeName(item.detail);
  if (transcript === label) return 100;
  if (transcript.includes(label) || label.includes(transcript)) return 80;
  const labelWords = label.split(" ").filter(Boolean);
  const matches = labelWords.filter((word) => transcript.includes(word)).length;
  if (matches > 0) return matches * 10;
  if (detail && transcript.includes(detail)) return 5;
  return 0;
}

function genericLandCharacteristics(): Characteristics {
  return {
    supertypes: [],
    cardTypes: ["Land"],
    subtypes: [],
    colors: [],
    manaValue: 0,
    isToken: false,
    isCreature: false,
    isLegendary: false,
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

function stableSequence(value: string): number {
  return Number.parseInt(stableHash(value).slice(0, 7), 16);
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function emptyDiagnostics(): AthenaTurnIntentDiagnostics {
  return {
    version: ATHENA_TURN_INTENT_VERSION,
    turnIntentsCreated: 0,
    preparedActionsCreated: 0,
    preparedActionsConfirmed: 0,
    preparedActionsCancelled: 0,
    preparedActionsInvalidated: 0,
    preparedActionsDiverged: 0,
    voiceConfirmations: 0,
    tapConfirmations: 0,
    duplicateConfirmationPreventions: 0,
    forecastReuseCount: 0,
    forecastInvalidationCount: 0,
    planRevalidationCount: 0,
    midTurnUpdates: 0,
    availableLandPlayUpdates: 0,
    unexpectedActionsDuringPlan: 0,
    staleActionRejections: 0,
    authorityRejections: 0,
    averageConfirmationToCommitMs: 0,
    maximumProcessingDurationMs: 0,
    lastPlanError: null,
    productionVisible: false,
  };
}
