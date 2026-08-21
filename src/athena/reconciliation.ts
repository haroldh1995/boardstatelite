import {
  createCardGroup,
  createGenericGroup,
  mergeCompatibleStacks,
  parseCharacteristics,
  recalculateStats,
  supportStatusForCard,
  withStackKey,
} from "../domain/cards";
import { calculateTotals } from "../domain/field";
import type {
  FieldState,
  PermanentGroup,
  RelevantTotalKey,
} from "../domain/types";
import {
  applyZoneCompositionCorrection,
  getZoneCompositionSnapshot,
  isZoneCategoryRelevantTotalKey,
  zoneCategoryFromRelevantTotal,
} from "../domain/zoneComposition";
import { monotonicNowMs } from "../platform/runtime";
import { athenaPerformanceMonitor } from "./performanceOptimization";
import {
  ATHENA_RECONCILIATION_SCHEMA_VERSION,
  ATHENA_RECONCILIATION_VERSION,
  type AthenaReconciliationDiagnostics,
  type AthenaReconciliationDiscrepancy,
  type AthenaReconciliationRecord,
  type AthenaReconciliationRepair,
  type AthenaReconciliationRequest,
  type AthenaReconciliationResult,
  type AthenaReconciliationState,
  type AthenaStructuredCorrectionIntent,
} from "./reconciliationTypes";

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const MAX_RECENT_RECONCILIATIONS = 30;

export function createDefaultAthenaReconciliationState(
  input: Partial<AthenaReconciliationState> = {},
): AthenaReconciliationState {
  return {
    schemaVersion: ATHENA_RECONCILIATION_SCHEMA_VERSION,
    version: ATHENA_RECONCILIATION_VERSION,
    active: normalizeRecord(input.active),
    recent: Array.isArray(input.recent)
      ? input.recent
          .map((entry) => normalizeRecord(entry))
          .filter((entry): entry is AthenaReconciliationRecord =>
            Boolean(entry),
          )
          .slice(-MAX_RECENT_RECONCILIATIONS)
      : [],
    lastBackgroundedAt: nullableString(input.lastBackgroundedAt),
    lastResumedAt: nullableString(input.lastResumedAt),
    catchUpSuggested: input.catchUpSuggested === true,
    updatedAt: nullableString(input.updatedAt) ?? DEFAULT_TIMESTAMP,
    diagnostics: normalizeDiagnostics(input.diagnostics),
  };
}

export function normalizeAthenaReconciliationState(
  value: unknown,
  timestamp = DEFAULT_TIMESTAMP,
): AthenaReconciliationState {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<AthenaReconciliationState>)
      : {};
  const state = createDefaultAthenaReconciliationState({
    ...candidate,
    updatedAt: nullableString(candidate.updatedAt) ?? timestamp,
  });
  if (state.active?.status === "applying") {
    const recovered: AthenaReconciliationRecord = {
      ...state.active,
      status: "failed",
      failureReason:
        "Interrupted reconciliation recovered without applying it again.",
      semanticSummary: "Interrupted reconciliation is available for review.",
      completedAt: timestamp,
    };
    return {
      ...state,
      active: null,
      recent: appendRecord(state.recent, recovered),
      updatedAt: timestamp,
      diagnostics: {
        ...state.diagnostics,
        recoveryFailures: state.diagnostics.recoveryFailures + 1,
        lastReconciliationError: recovered.failureReason,
      },
    };
  }
  return state;
}

export function createAthenaReconciliationRequest(input: {
  field: FieldState;
  repairs: AthenaReconciliationRepair[];
  source?: AthenaReconciliationRequest["source"];
  level?: AthenaReconciliationRequest["level"];
  confidence?: AthenaReconciliationRequest["confidence"];
  atomic?: boolean;
  timestamp?: string;
  provenance?: string;
  relatedSnapshotIds?: string[];
  relatedCanonicalEventIds?: string[];
}): AthenaReconciliationRequest {
  const timestamp = input.timestamp ?? input.field.updatedAt;
  const source = input.source ?? "manual-correction";
  const repairSignature = input.repairs
    .map((repair) => `${repair.id}:${repair.kind}`)
    .join("|");
  return {
    id: stableId(
      "reconciliation",
      `${input.field.session.id}:${input.field.preTurnPlanner.turnId}:${source}:${timestamp}:${repairSignature}`,
    ),
    sessionId: input.field.session.id,
    participantId: input.field.multiplayer.registry.localParticipantId,
    turnId: input.field.preTurnPlanner.turnId,
    source,
    level:
      input.level ??
      (input.repairs.length > 1
        ? "battlefield-reconciliation"
        : "quick-correction"),
    confidence: input.confidence ?? "exact",
    canonicalStateVersion: `${input.field.session.version}:${input.field.session.lastModifiedAt}`,
    localStateVersion: input.field.updatedAt,
    correctionOnly: true,
    atomic: input.atomic !== false,
    repairs: dedupeRepairs(input.repairs),
    relatedSnapshotIds: uniqueStrings(input.relatedSnapshotIds ?? []),
    relatedCanonicalEventIds: uniqueStrings(
      input.relatedCanonicalEventIds ?? [],
    ),
    createdAt: timestamp,
    provenance: sanitizeText(input.provenance, source),
  };
}

export function applyAthenaReconciliation(
  field: FieldState,
  request: AthenaReconciliationRequest,
): AthenaReconciliationResult {
  const started = monotonicNowMs();
  const priorState = normalizeAthenaReconciliationState(
    field.athena.reconciliation,
    request.createdAt,
  );
  const validationFailure = validateRequest(field, request);
  if (validationFailure) {
    return failedResult(field, priorState, request, validationFailure, started);
  }
  const failures = request.repairs
    .map((repair) => ({ repair, reason: validateRepair(field, repair) }))
    .filter((entry) => Boolean(entry.reason));
  if (failures.length > 0 && request.atomic) {
    return failedResult(
      field,
      priorState,
      request,
      failures.map((entry) => entry.reason).join(" "),
      started,
      failures.map((entry) => entry.repair.id),
    );
  }

  let working = field;
  const discrepancies: AthenaReconciliationDiscrepancy[] = [];
  const appliedRepairIds: string[] = [];
  const rejectedRepairIds = failures.map((entry) => entry.repair.id);
  for (const repair of request.repairs) {
    if (rejectedRepairIds.includes(repair.id)) continue;
    const currentFailure = validateRepair(working, repair);
    if (currentFailure) {
      if (request.atomic) {
        return failedResult(
          field,
          priorState,
          request,
          currentFailure,
          started,
          [repair.id],
        );
      }
      rejectedRepairIds.push(repair.id);
      continue;
    }
    const applied = applyRepair(working, repair, request);
    if (!applied.ok) {
      if (request.atomic) {
        return failedResult(
          field,
          priorState,
          request,
          applied.reason,
          started,
          [repair.id],
        );
      }
      rejectedRepairIds.push(repair.id);
      continue;
    }
    working = applied.field;
    if (applied.discrepancy) {
      discrepancies.push(applied.discrepancy);
      appliedRepairIds.push(repair.id);
    }
  }

  const duration = Math.max(0, monotonicNowMs() - started);
  const status =
    discrepancies.length === 0 && rejectedRepairIds.length === 0
      ? "no-change"
      : rejectedRepairIds.length > 0
        ? "rejected"
        : "completed";
  const summary = reconciliationSummary(discrepancies);
  const record = createRecord(request, {
    status,
    discrepancyCount: discrepancies.length,
    repairIds: appliedRepairIds,
    rejectedRepairIds,
    semanticSummary: summary,
    completedAt: request.createdAt,
    failureReason:
      rejectedRepairIds.length > 0
        ? "Some independent corrections were rejected."
        : null,
  });
  const diagnostics = updateDiagnostics(
    priorState.diagnostics,
    request,
    discrepancies,
    duration,
    status === "completed" || status === "no-change",
  );
  const state: AthenaReconciliationState = {
    ...priorState,
    active: null,
    recent: appendRecord(priorState.recent, record),
    catchUpSuggested: false,
    updatedAt: request.createdAt,
    diagnostics,
  };
  working = {
    ...working,
    updatedAt: request.createdAt,
    athena: { ...working.athena, reconciliation: state },
  };
  athenaPerformanceMonitor.recordDuration("reconciliation", duration, {
    workUnits: request.repairs.length,
    recordedAt: request.createdAt,
    enabled: field.settings.athena.developerDiagnosticsEnabled,
  });
  return {
    ok: rejectedRepairIds.length === 0,
    status,
    field: working,
    state,
    record,
    discrepancies,
    appliedRepairIds,
    rejectedRepairIds,
    generatedGameEvents: [],
    semanticDescription: summary,
    accessibilityDescription: summary,
    failureReason: record.failureReason,
  };
}

export function markAthenaReconciliationLifecycle(
  field: FieldState,
  event: "app-backgrounded" | "app-foregrounded",
  timestamp: string,
): FieldState {
  const state = normalizeAthenaReconciliationState(
    field.athena.reconciliation,
    timestamp,
  );
  if (event === "app-backgrounded") {
    return {
      ...field,
      athena: {
        ...field.athena,
        reconciliation: {
          ...state,
          lastBackgroundedAt: timestamp,
          updatedAt: timestamp,
        },
      },
    };
  }
  const activeTurn = [
    "activeTurn",
    "combat",
    "resolution",
    "recovery",
  ].includes(field.ambient.currentMode);
  const next: AthenaReconciliationState = {
    ...state,
    lastResumedAt: timestamp,
    catchUpSuggested: activeTurn && Boolean(state.lastBackgroundedAt),
    updatedAt: timestamp,
    diagnostics: {
      ...state.diagnostics,
      appResumeReconciliations: state.diagnostics.appResumeReconciliations + 1,
    },
  };
  return { ...field, athena: { ...field.athena, reconciliation: next } };
}

export function structuredCorrectionIntentToRequest(input: {
  field: FieldState;
  intent: AthenaStructuredCorrectionIntent;
}): AthenaReconciliationRequest | null {
  if (
    !input.intent.speakerVerified ||
    !["correction", "catch-me-up"].includes(input.intent.disposition) ||
    input.intent.repairs.length === 0
  ) {
    return null;
  }
  return createAthenaReconciliationRequest({
    field: input.field,
    repairs: input.intent.repairs,
    source: "echo-correction",
    level:
      input.intent.disposition === "catch-me-up"
        ? "catch-me-up"
        : input.intent.repairs.length > 1
          ? "battlefield-reconciliation"
          : "quick-correction",
    timestamp: input.intent.createdAt,
    provenance: input.intent.id,
  });
}

export function canSafelyProcessMissedRealGameAction(input: {
  request: AthenaReconciliationRequest;
  historicalSnapshotId?: string | null;
  exactEventTimestamp?: string | null;
  boardStateAuthorityAvailable?: boolean;
}): {
  safe: boolean;
  disposition: "process-real-action" | "correction-only" | "authority-required";
  reason: string;
} {
  if (input.request.level !== "missed-real-game-action") {
    return {
      safe: false,
      disposition: "correction-only",
      reason: "The request describes current state, not a historical action.",
    };
  }
  if (input.historicalSnapshotId && input.exactEventTimestamp) {
    return {
      safe: true,
      disposition: "process-real-action",
      reason:
        "Exact historical context is available for the canonical pipeline.",
    };
  }
  if (input.boardStateAuthorityAvailable) {
    return {
      safe: false,
      disposition: "authority-required",
      reason:
        "BoardState authority is required to reconstruct the missed action.",
    };
  }
  return {
    safe: false,
    disposition: "correction-only",
    reason:
      "Historical context is incomplete. Correct current state without inventing consequences.",
  };
}

function applyRepair(
  field: FieldState,
  repair: AthenaReconciliationRepair,
  request: AthenaReconciliationRequest,
):
  | {
      ok: true;
      field: FieldState;
      discrepancy: AthenaReconciliationDiscrepancy | null;
    }
  | { ok: false; reason: string } {
  if (repair.kind === "set-life") {
    const value = integer(repair.value);
    return simpleRepair(
      field,
      repair,
      field.player.life,
      value,
      `Life corrected from ${field.player.life} to ${value}.`,
      {
        ...field,
        player: { ...field.player, life: value },
      },
      request,
    );
  }
  if (repair.kind === "set-player-counter") {
    const before = field.player.counters[repair.counter];
    const value = nonnegative(repair.value);
    return simpleRepair(
      field,
      repair,
      before,
      value,
      `${playerCounterLabel(repair.counter)} corrected from ${before} to ${value}.`,
      {
        ...field,
        player: {
          ...field.player,
          counters: { ...field.player.counters, [repair.counter]: value },
        },
      },
      request,
    );
  }
  if (repair.kind === "set-group-quantity") {
    const group = field.groups.find((entry) => entry.id === repair.groupId)!;
    const value = nonnegative(repair.value);
    const nextGroups =
      value === 0
        ? removeGroupRepresentation(field.groups, group.id)
        : field.groups.map((entry) =>
            entry.id === group.id
              ? withStackKey({ ...entry, quantity: value })
              : entry,
          );
    return simpleRepair(
      field,
      repair,
      group.quantity,
      value,
      `${group.label} quantity corrected from ${group.quantity} to ${value}.`,
      { ...field, groups: nextGroups },
      request,
    );
  }
  if (repair.kind === "set-counter") {
    const group = field.groups.find((entry) => entry.id === repair.groupId)!;
    const before = group.counters[repair.counter] ?? 0;
    const value = nonnegative(repair.value);
    const counters = { ...group.counters };
    if (value === 0) delete counters[repair.counter];
    else counters[repair.counter] = value;
    const groups = field.groups.map((entry) =>
      entry.id === group.id
        ? withStackKey(recalculateStats({ ...entry, counters }))
        : entry,
    );
    return simpleRepair(
      field,
      repair,
      before,
      value,
      `${repair.counter} counters on ${group.label} corrected from ${before} to ${value}.`,
      { ...field, groups },
      request,
    );
  }
  if (repair.kind === "set-base-power-toughness") {
    const group = field.groups.find((entry) => entry.id === repair.groupId)!;
    const before = `${group.pt.basePower ?? "-"}/${group.pt.baseToughness ?? "-"}`;
    const after = `${repair.power ?? "-"}/${repair.toughness ?? "-"}`;
    const groups = field.groups.map((entry) =>
      entry.id === group.id
        ? withStackKey(
            recalculateStats({
              ...entry,
              pt: {
                ...entry.pt,
                basePower: repair.power,
                baseToughness: repair.toughness,
              },
            }),
          )
        : entry,
    );
    return simpleRepair(
      field,
      repair,
      before,
      after,
      `${group.label} base power and toughness corrected to ${after}.`,
      { ...field, groups },
      request,
    );
  }
  if (repair.kind === "set-attachment") {
    const attachment = field.groups.find(
      (entry) => entry.id === repair.attachmentId,
    )!;
    const previousTarget = attachment.attachedTo;
    let groups = field.groups.map((entry) => ({
      ...entry,
      attachments: entry.attachments.filter((id) => id !== repair.attachmentId),
    }));
    groups = groups.map((entry) => {
      if (entry.id === repair.attachmentId) {
        return withStackKey({ ...entry, attachedTo: repair.attachedTo });
      }
      if (entry.id === repair.attachedTo) {
        return withStackKey({
          ...entry,
          attachments: uniqueStrings([
            ...entry.attachments,
            repair.attachmentId,
          ]),
        });
      }
      return entry;
    });
    return simpleRepair(
      field,
      repair,
      previousTarget,
      repair.attachedTo,
      `${attachment.label} attachment relationship corrected.`,
      { ...field, groups },
      request,
    );
  }
  if (
    repair.kind === "replace-identity" ||
    repair.kind === "set-current-face"
  ) {
    const group = field.groups.find((entry) => entry.id === repair.groupId)!;
    const identity = repair.identity;
    const characteristics = parseCharacteristics(identity.typeLine, identity);
    const corrected = withStackKey(
      recalculateStats({
        ...group,
        label: identity.name,
        identity: {
          ...identity,
          supportStatus: supportStatusForCard(
            identity.name,
            identity.oracleText,
          ),
        },
        originalIdentity:
          repair.kind === "replace-identity"
            ? identity
            : (group.originalIdentity ?? identity),
        originalCharacteristics:
          repair.kind === "replace-identity"
            ? characteristics
            : (group.originalCharacteristics ?? characteristics),
        characteristics: {
          ...characteristics,
          isToken: group.characteristics.isToken,
        },
        isGeneric: false,
        statuses: {
          ...group.statuses,
          transformed:
            repair.kind === "set-current-face"
              ? repair.transformed
              : group.statuses.transformed,
        },
        pt: {
          ...group.pt,
          printedPower: numericStat(identity.power),
          printedToughness: numericStat(identity.toughness),
          basePower: numericStat(identity.power),
          baseToughness: numericStat(identity.toughness),
        },
      }),
    );
    return simpleRepair(
      field,
      repair,
      group.identity?.name ?? group.label,
      identity.name,
      `${group.label} identity corrected to ${identity.name}.`,
      {
        ...field,
        groups: field.groups.map((entry) =>
          entry.id === group.id ? corrected : entry,
        ),
      },
      request,
    );
  }
  if (repair.kind === "add-card-already-present") {
    const group = createCardGroup(
      repair.identity,
      nonnegative(repair.quantity),
      repair.zone,
    );
    const deterministic = withStackKey({
      ...group,
      id: stableId("reconciled-object", `${request.id}:${repair.id}`),
      order: field.groups.length + 1,
    });
    return {
      ok: true,
      field: {
        ...field,
        groups: mergeCompatibleStacks([...field.groups, deterministic]),
        recentCards: [
          repair.identity,
          ...field.recentCards.filter(
            (card) => card.cardId !== repair.identity.cardId,
          ),
        ].slice(0, 20),
      },
      discrepancy: discrepancy(
        request,
        repair,
        null,
        repair.quantity,
        `${repair.quantity} ${repair.identity.name} added as already present.`,
      ),
    };
  }
  if (repair.kind === "add-generic-already-present") {
    const group = createGenericGroup({
      kind: genericKind(repair),
      label: repair.label,
      quantity: nonnegative(repair.quantity),
      power: repair.power,
      toughness: repair.toughness,
      zone: repair.zone,
      cardTypes: repair.cardTypes,
      subtypes: repair.subtypes,
      token: repair.token,
    });
    const deterministic = withStackKey({
      ...group,
      id: stableId("reconciled-object", `${request.id}:${repair.id}`),
      order: field.groups.length + 1,
    });
    return {
      ok: true,
      field: {
        ...field,
        groups: mergeCompatibleStacks([...field.groups, deterministic]),
      },
      discrepancy: discrepancy(
        request,
        repair,
        null,
        repair.quantity,
        `${repair.quantity} ${repair.label} added as already present.`,
      ),
    };
  }
  if (repair.kind === "remove-object-representation") {
    const group = field.groups.find((entry) => entry.id === repair.groupId)!;
    return {
      ok: true,
      field: {
        ...field,
        groups: removeGroupRepresentation(field.groups, group.id),
      },
      discrepancy: discrepancy(
        request,
        repair,
        group.quantity,
        0,
        `${group.label} removed from the current representation.`,
      ),
    };
  }
  if (repair.kind === "set-zone-composition") {
    const before = getZoneCompositionSnapshot(field, repair.zone);
    const result = applyZoneCompositionCorrection(field, {
      zone: repair.zone,
      physicalTotal: repair.physicalTotal,
      manuallyAccountedPhysicalCards: repair.manuallyAccountedPhysicalCards,
      categoryTotals: repair.categoryTotals,
    });
    if (!result.ok) return { ok: false, reason: result.reason };
    const after = getZoneCompositionSnapshot(result.field, repair.zone);
    const changed =
      before.physicalTotal !== after.physicalTotal ||
      JSON.stringify(before.categories) !== JSON.stringify(after.categories);
    return {
      ok: true,
      field: result.field,
      discrepancy: changed
        ? discrepancy(
            request,
            repair,
            before.physicalTotal,
            after.physicalTotal,
            result.summary.join(" "),
          )
        : null,
    };
  }
  if (repair.kind === "set-relevant-total") {
    return applyRelevantTotalRepair(field, repair, request);
  }
  return { ok: false, reason: "Unsupported reconciliation repair." };
}

function applyRelevantTotalRepair(
  field: FieldState,
  repair: Extract<AthenaReconciliationRepair, { kind: "set-relevant-total" }>,
  request: AthenaReconciliationRequest,
): ReturnType<typeof applyRepair> {
  if (repair.key === "cardsInGraveyard" || repair.key === "cardsInExile") {
    return applyRepair(
      field,
      {
        id: repair.id,
        kind: "set-zone-composition",
        zone: repair.key === "cardsInGraveyard" ? "graveyard" : "exile",
        physicalTotal: repair.value,
      },
      request,
    );
  }
  if (isZoneCategoryRelevantTotalKey(repair.key)) {
    const zone = repair.key.startsWith("graveyard.") ? "graveyard" : "exile";
    const category = zoneCategoryFromRelevantTotal(repair.key, zone);
    if (!category)
      return { ok: false, reason: "Zone category could not be identified." };
    return applyRepair(
      field,
      {
        id: repair.id,
        kind: "set-zone-composition",
        zone,
        categoryTotals: { [category]: repair.value },
      },
      request,
    );
  }
  const totals = calculateTotals(field.groups);
  const before = totals[repair.key] ?? 0;
  const value = nonnegative(repair.value);
  if (before === value) {
    return { ok: true, field, discrepancy: null };
  }
  const delta = value - before;
  const adjusted = adjustAnonymousTotal(
    field.groups,
    repair.key,
    delta,
    request,
  );
  if (!adjusted.ok) return adjusted;
  return {
    ok: true,
    field: { ...field, groups: adjusted.groups },
    discrepancy: discrepancy(
      request,
      repair,
      before,
      value,
      `${relevantTotalLabel(repair.key)} corrected from ${before} to ${value}.`,
    ),
  };
}

function adjustAnonymousTotal(
  groups: PermanentGroup[],
  key: RelevantTotalKey,
  delta: number,
  request: AthenaReconciliationRequest,
): { ok: true; groups: PermanentGroup[] } | { ok: false; reason: string } {
  const template = anonymousTemplate(key);
  if (!template) {
    return {
      ok: false,
      reason: `${relevantTotalLabel(key)} requires a specific object or category correction.`,
    };
  }
  if (delta > 0) {
    const group = createGenericGroup({ ...template, quantity: delta });
    return {
      ok: true,
      groups: mergeCompatibleStacks([
        ...groups,
        withStackKey({
          ...group,
          id: stableId("reconciled-total", `${request.id}:${key}`),
          order: groups.length + 1,
        }),
      ]),
    };
  }
  let remaining = Math.abs(delta);
  const eligible = groups.filter(
    (group) =>
      group.isGeneric &&
      group.identity === null &&
      groupMatchesRelevantTotal(group, key),
  );
  const available = eligible.reduce((sum, group) => sum + group.quantity, 0);
  if (available < remaining) {
    return {
      ok: false,
      reason: `Select the specific ${relevantTotalLabel(key).toLowerCase()} objects that are no longer present.`,
    };
  }
  const eligibleIds = new Set(eligible.map((group) => group.id));
  const next = groups
    .map((group) => {
      if (!eligibleIds.has(group.id) || remaining === 0) return group;
      const removed = Math.min(group.quantity, remaining);
      remaining -= removed;
      return withStackKey({ ...group, quantity: group.quantity - removed });
    })
    .filter((group) => group.quantity > 0);
  return { ok: true, groups: next };
}

function validateRequest(
  field: FieldState,
  request: AthenaReconciliationRequest,
): string | null {
  if (request.sessionId !== field.session.id)
    return "Reconciliation belongs to a different canonical session.";
  if (request.participantId !== field.multiplayer.registry.localParticipantId) {
    return "Reconciliation belongs to a different participant.";
  }
  if (request.turnId && request.turnId !== field.preTurnPlanner.turnId)
    return "Reconciliation belongs to a different turn.";
  if (!request.correctionOnly)
    return "Reconciliation must use Correction Only semantics.";
  if (
    field.session.currentSessionAuthority === "boardstate-authority" &&
    request.source !== "boardstate-authority"
  ) {
    return "BoardState authoritative session state requires authority reconciliation.";
  }
  if (request.repairs.length > 500)
    return "Reconciliation safety budget exceeded.";
  return null;
}

function validateRepair(
  field: FieldState,
  repair: AthenaReconciliationRepair,
): string | null {
  if (!repair.id) return "A repair is missing stable identity.";
  if ("value" in repair && !Number.isFinite(repair.value))
    return `Repair ${repair.id} has an invalid quantity.`;
  if ("value" in repair && repair.kind !== "set-life" && repair.value < 0) {
    return `Repair ${repair.id} cannot use a negative quantity.`;
  }
  if (
    [
      "set-group-quantity",
      "set-counter",
      "set-base-power-toughness",
      "replace-identity",
      "set-current-face",
      "remove-object-representation",
    ].includes(repair.kind)
  ) {
    const groupId = "groupId" in repair ? repair.groupId : null;
    if (!groupId || !field.groups.some((group) => group.id === groupId))
      return `Repair ${repair.id} references a missing object.`;
  }
  if (repair.kind === "set-attachment") {
    if (!field.groups.some((group) => group.id === repair.attachmentId))
      return "Attachment object is missing.";
    if (
      repair.attachedTo &&
      !field.groups.some((group) => group.id === repair.attachedTo)
    ) {
      return "Attachment target is missing.";
    }
    if (repair.attachmentId === repair.attachedTo)
      return "An object cannot attach to itself.";
  }
  if (
    repair.kind === "add-card-already-present" ||
    repair.kind === "add-generic-already-present"
  ) {
    if (!Number.isInteger(repair.quantity) || repair.quantity < 1)
      return "An already-present object needs a positive quantity.";
  }
  if (repair.kind === "set-zone-composition") {
    if (
      repair.physicalTotal !== undefined &&
      (!Number.isInteger(repair.physicalTotal) || repair.physicalTotal < 0)
    ) {
      return "Zone physical total must be a nonnegative integer.";
    }
    for (const value of Object.values(repair.categoryTotals ?? {})) {
      if (!Number.isInteger(value) || (value ?? -1) < 0)
        return "Zone category totals must be nonnegative integers.";
    }
  }
  return null;
}

function failedResult(
  field: FieldState,
  state: AthenaReconciliationState,
  request: AthenaReconciliationRequest,
  reason: string,
  started: number,
  rejectedRepairIds = request.repairs.map((repair) => repair.id),
): AthenaReconciliationResult {
  const duration = Math.max(0, monotonicNowMs() - started);
  athenaPerformanceMonitor.recordDuration("reconciliation", duration, {
    workUnits: request.repairs.length,
    recordedAt: request.createdAt,
    enabled: field.settings.athena.developerDiagnosticsEnabled,
  });
  const record = createRecord(request, {
    status: "failed",
    discrepancyCount: 0,
    repairIds: [],
    rejectedRepairIds,
    semanticSummary: "Current state was not changed.",
    completedAt: request.createdAt,
    failureReason: sanitizeText(reason, "Reconciliation failed safely."),
  });
  const diagnostics = {
    ...state.diagnostics,
    reconciliationsStarted: state.diagnostics.reconciliationsStarted + 1,
    recoveryFailures: state.diagnostics.recoveryFailures + 1,
    maximumReconciliationDurationMs: Math.max(
      state.diagnostics.maximumReconciliationDurationMs,
      duration,
    ),
    lastReconciliationError: record.failureReason,
  };
  const nextState: AthenaReconciliationState = {
    ...state,
    active: null,
    recent: appendRecord(state.recent, record),
    updatedAt: request.createdAt,
    diagnostics,
  };
  return {
    ok: false,
    status: "failed",
    field: { ...field, athena: { ...field.athena, reconciliation: nextState } },
    state: nextState,
    record,
    discrepancies: [],
    appliedRepairIds: [],
    rejectedRepairIds,
    generatedGameEvents: [],
    semanticDescription: record.failureReason ?? record.semanticSummary,
    accessibilityDescription: record.failureReason ?? record.semanticSummary,
    failureReason: record.failureReason,
  };
}

function simpleRepair(
  field: FieldState,
  repair: AthenaReconciliationRepair,
  before: string | number | boolean | null,
  after: string | number | boolean | null,
  description: string,
  next: FieldState,
  request: AthenaReconciliationRequest,
): ReturnType<typeof applyRepair> {
  if (before === after) return { ok: true, field, discrepancy: null };
  return {
    ok: true,
    field: next,
    discrepancy: discrepancy(request, repair, before, after, description),
  };
}

function discrepancy(
  request: AthenaReconciliationRequest,
  repair: AthenaReconciliationRepair,
  before: string | number | boolean | null,
  after: string | number | boolean | null,
  semanticDescription: string,
): AthenaReconciliationDiscrepancy {
  return {
    id: stableId("discrepancy", `${request.id}:${repair.id}`),
    repairId: repair.id,
    kind: repair.kind,
    targetId:
      "groupId" in repair
        ? repair.groupId
        : "attachmentId" in repair
          ? repair.attachmentId
          : repair.kind === "set-relevant-total"
            ? repair.key
            : repair.kind === "set-zone-composition"
              ? repair.zone
              : null,
    before,
    after,
    confidence: request.confidence,
    semanticDescription: sanitizeText(
      semanticDescription,
      "Current state corrected.",
    ),
  };
}

function createRecord(
  request: AthenaReconciliationRequest,
  input: Pick<
    AthenaReconciliationRecord,
    | "status"
    | "discrepancyCount"
    | "repairIds"
    | "rejectedRepairIds"
    | "semanticSummary"
    | "completedAt"
    | "failureReason"
  >,
): AthenaReconciliationRecord {
  return {
    id: request.id,
    sessionId: request.sessionId,
    participantId: request.participantId,
    turnId: request.turnId,
    source: request.source,
    level: request.level,
    confidence: request.confidence,
    status: input.status,
    canonicalStateVersion: request.canonicalStateVersion,
    localStateVersion: request.localStateVersion,
    discrepancyCount: input.discrepancyCount,
    repairIds: input.repairIds,
    rejectedRepairIds: input.rejectedRepairIds,
    relatedSnapshotIds: request.relatedSnapshotIds,
    relatedCanonicalEventIds: request.relatedCanonicalEventIds,
    unknownHistory: request.level !== "missed-real-game-action",
    correctionOnly: true,
    gameplayEventsGenerated: 0,
    replacementEffectsApplied: false,
    triggersGenerated: 0,
    semanticSummary: input.semanticSummary,
    failureReason: input.failureReason,
    startedAt: request.createdAt,
    completedAt: input.completedAt,
    provenance: request.provenance,
  };
}

function updateDiagnostics(
  current: AthenaReconciliationDiagnostics,
  request: AthenaReconciliationRequest,
  discrepancies: AthenaReconciliationDiscrepancy[],
  duration: number,
  completed: boolean,
): AthenaReconciliationDiagnostics {
  const next = { ...current };
  const completedCount = next.reconciliationsCompleted + (completed ? 1 : 0);
  next.reconciliationsStarted += 1;
  if (completed) next.reconciliationsCompleted = completedCount;
  if (request.level === "quick-correction") next.quickCorrections += 1;
  if (request.level === "catch-me-up") next.catchMeUpSessions += 1;
  if (request.repairs.length > 1) next.batchCorrections += 1;
  if (request.source === "echo-correction") next.voiceCorrections += 1;
  if (request.source === "boardstate-authority")
    next.authorityReconciliations += 1;
  if (request.source === "sync-update") next.syncConflicts += 1;
  if (request.source === "app-resume") next.appResumeReconciliations += 1;
  for (const discrepancy of discrepancies) {
    if (["replace-identity", "set-current-face"].includes(discrepancy.kind))
      next.identityCorrections += 1;
    if (
      discrepancy.kind === "set-zone-composition" ||
      (discrepancy.kind === "set-relevant-total" &&
        String(discrepancy.targetId).includes("."))
    )
      next.zoneCorrections += 1;
    if (discrepancy.kind === "set-group-quantity") next.tokenCorrections += 1;
    if (discrepancy.kind === "set-counter") next.counterCorrections += 1;
    if (discrepancy.kind === "set-life") next.lifeCorrections += 1;
    if (
      discrepancy.kind === "set-player-counter" &&
      request.repairs.some(
        (repair) =>
          repair.id === discrepancy.repairId &&
          repair.kind === "set-player-counter" &&
          repair.counter === "commanderDamage",
      )
    )
      next.commanderDamageCorrections += 1;
  }
  next.correctionsWithoutTriggers += discrepancies.length;
  next.averageFieldsCorrected = average(
    next.averageFieldsCorrected,
    next.reconciliationsCompleted,
    discrepancies.length,
  );
  next.averageReconciliationDurationMs = average(
    next.averageReconciliationDurationMs,
    next.reconciliationsCompleted,
    duration,
  );
  next.maximumReconciliationDurationMs = Math.max(
    next.maximumReconciliationDurationMs,
    duration,
  );
  next.lastReconciliationError = null;
  return next;
}

function reconciliationSummary(
  discrepancies: AthenaReconciliationDiscrepancy[],
): string {
  if (discrepancies.length === 0) return "Current state already matched.";
  if (discrepancies.length === 1) return discrepancies[0].semanticDescription;
  return `${discrepancies.length} battlefield values corrected. Current state reconciled.`;
}

function removeGroupRepresentation(
  groups: PermanentGroup[],
  groupId: string,
): PermanentGroup[] {
  return groups
    .filter((group) => group.id !== groupId)
    .map((group) =>
      withStackKey({
        ...group,
        attachedTo: group.attachedTo === groupId ? null : group.attachedTo,
        attachments: group.attachments.filter((id) => id !== groupId),
      }),
    );
}

function anonymousTemplate(
  key: RelevantTotalKey,
): Parameters<typeof createGenericGroup>[0] | null {
  if (key === "lands")
    return { kind: "Land", label: "Reconciled lands", quantity: 1 };
  if (key === "cardsInHand")
    return {
      kind: "Custom",
      label: "Unidentified cards in hand",
      quantity: 1,
      zone: "hand",
    };
  if (key === "cardsRemainingInLibrary")
    return {
      kind: "Custom",
      label: "Unidentified cards in library",
      quantity: 1,
      zone: "library",
    };
  if (key === "creatures")
    return { kind: "Creature", label: "Reconciled creatures", quantity: 1 };
  if (key === "artifacts")
    return { kind: "Artifact", label: "Reconciled artifacts", quantity: 1 };
  if (key === "enchantments")
    return {
      kind: "Enchantment",
      label: "Reconciled enchantments",
      quantity: 1,
    };
  if (key === "tokens")
    return {
      kind: "Token",
      label: "Reconciled tokens",
      quantity: 1,
      token: true,
    };
  if (key === "treasureTokens")
    return {
      kind: "Token",
      label: "Treasure",
      quantity: 1,
      token: true,
      cardTypes: ["Artifact"],
      subtypes: ["Treasure"],
    };
  return null;
}

function groupMatchesRelevantTotal(
  group: PermanentGroup,
  key: RelevantTotalKey,
): boolean {
  const types = new Set(group.characteristics.cardTypes);
  const subtypes = new Set(group.characteristics.subtypes);
  if (key === "lands") return group.zone === "battlefield" && types.has("Land");
  if (key === "cardsInHand") return group.zone === "hand";
  if (key === "cardsRemainingInLibrary") return group.zone === "library";
  if (key === "creatures")
    return group.zone === "battlefield" && types.has("Creature");
  if (key === "artifacts")
    return group.zone === "battlefield" && types.has("Artifact");
  if (key === "enchantments")
    return group.zone === "battlefield" && types.has("Enchantment");
  if (key === "tokens")
    return group.zone === "battlefield" && group.characteristics.isToken;
  if (key === "treasureTokens")
    return (
      group.zone === "battlefield" &&
      group.characteristics.isToken &&
      subtypes.has("Treasure")
    );
  return false;
}

function genericKind(
  repair: Extract<
    AthenaReconciliationRepair,
    { kind: "add-generic-already-present" }
  >,
): Parameters<typeof createGenericGroup>[0]["kind"] {
  if (repair.token) return "Token";
  if (repair.cardTypes.includes("Creature")) return "Creature";
  if (repair.cardTypes.includes("Artifact")) return "Artifact";
  if (repair.cardTypes.includes("Enchantment")) return "Enchantment";
  if (repair.cardTypes.includes("Land")) return "Land";
  return "Custom";
}

function relevantTotalLabel(key: RelevantTotalKey): string {
  const labels: Partial<Record<RelevantTotalKey, string>> = {
    lands: "Lands",
    cardsInHand: "Hand",
    cardsRemainingInLibrary: "Library",
    creatures: "Creatures",
    artifacts: "Artifacts",
    enchantments: "Enchantments",
    tokens: "Tokens",
    treasureTokens: "Treasures",
  };
  return labels[key] ?? String(key);
}

function playerCounterLabel(
  key: Extract<
    AthenaReconciliationRepair,
    { kind: "set-player-counter" }
  >["counter"],
): string {
  if (key === "commanderDamage") return "Commander damage";
  return `${key.slice(0, 1).toUpperCase()}${key.slice(1)}`;
}

function numericStat(value: string | null): number | null {
  if (value === null || !/^-?\d+$/.test(value)) return null;
  return Number(value);
}

function createDefaultDiagnostics(): AthenaReconciliationDiagnostics {
  return {
    version: ATHENA_RECONCILIATION_VERSION,
    reconciliationsStarted: 0,
    reconciliationsCompleted: 0,
    quickCorrections: 0,
    catchMeUpSessions: 0,
    batchCorrections: 0,
    identityCorrections: 0,
    zoneCorrections: 0,
    tokenCorrections: 0,
    counterCorrections: 0,
    lifeCorrections: 0,
    commanderDamageCorrections: 0,
    voiceCorrections: 0,
    missedRealGameActionsProcessed: 0,
    correctionsWithoutTriggers: 0,
    preparedActionsInvalidated: 0,
    decisionsInvalidated: 0,
    authorityReconciliations: 0,
    syncConflicts: 0,
    appResumeReconciliations: 0,
    recoveryFailures: 0,
    averageReconciliationDurationMs: 0,
    averageFieldsCorrected: 0,
    maximumReconciliationDurationMs: 0,
    lastReconciliationError: null,
    productionVisible: false,
  };
}

function normalizeDiagnostics(value: unknown): AthenaReconciliationDiagnostics {
  const defaults = createDefaultDiagnostics();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<AthenaReconciliationDiagnostics>;
  const output = { ...defaults };
  for (const key of Object.keys(defaults) as Array<
    keyof AthenaReconciliationDiagnostics
  >) {
    if (key === "version" || key === "productionVisible") continue;
    if (key === "lastReconciliationError") {
      output.lastReconciliationError = nullableString(candidate[key]);
      continue;
    }
    const candidateValue = candidate[key];
    if (typeof candidateValue === "number" && Number.isFinite(candidateValue)) {
      (output[key] as number) = Math.max(0, candidateValue);
    }
  }
  return output;
}

function normalizeRecord(value: unknown): AthenaReconciliationRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AthenaReconciliationRecord>;
  const id = nullableString(candidate.id);
  const sessionId = nullableString(candidate.sessionId);
  const participantId = nullableString(candidate.participantId);
  if (!id || !sessionId || !participantId) return null;
  return {
    id,
    sessionId,
    participantId,
    turnId: nullableString(candidate.turnId),
    source: candidate.source ?? "manual-correction",
    level: candidate.level ?? "quick-correction",
    confidence: candidate.confidence ?? "exact",
    status: candidate.status ?? "failed",
    canonicalStateVersion:
      nullableString(candidate.canonicalStateVersion) ?? DEFAULT_TIMESTAMP,
    localStateVersion:
      nullableString(candidate.localStateVersion) ?? DEFAULT_TIMESTAMP,
    discrepancyCount: nonnegative(candidate.discrepancyCount ?? 0),
    repairIds: uniqueStrings(candidate.repairIds ?? []),
    rejectedRepairIds: uniqueStrings(candidate.rejectedRepairIds ?? []),
    relatedSnapshotIds: uniqueStrings(candidate.relatedSnapshotIds ?? []),
    relatedCanonicalEventIds: uniqueStrings(
      candidate.relatedCanonicalEventIds ?? [],
    ),
    unknownHistory: candidate.unknownHistory !== false,
    correctionOnly: true,
    gameplayEventsGenerated: 0,
    replacementEffectsApplied: false,
    triggersGenerated: 0,
    semanticSummary: sanitizeText(
      candidate.semanticSummary,
      "Current state reconciled.",
    ),
    failureReason: nullableString(candidate.failureReason),
    startedAt: nullableString(candidate.startedAt) ?? DEFAULT_TIMESTAMP,
    completedAt: nullableString(candidate.completedAt),
    provenance: sanitizeText(candidate.provenance, "reconciliation"),
  };
}

function appendRecord(
  records: AthenaReconciliationRecord[],
  record: AthenaReconciliationRecord,
): AthenaReconciliationRecord[] {
  return [...records.filter((entry) => entry.id !== record.id), record].slice(
    -MAX_RECENT_RECONCILIATIONS,
  );
}

function dedupeRepairs(
  repairs: AthenaReconciliationRepair[],
): AthenaReconciliationRepair[] {
  const seen = new Set<string>();
  return repairs.filter((repair) => {
    if (seen.has(repair.id)) return false;
    seen.add(repair.id);
    return true;
  });
}

function average(current: number, count: number, value: number): number {
  if (count <= 1) return value;
  return (current * (count - 1) + value) / count;
}

function stableId(prefix: string, value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`;
}

function uniqueStrings(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === "string"),
    ),
  ];
}

function integer(value: number): number {
  return Math.trunc(Math.max(Number.MIN_SAFE_INTEGER, value));
}

function nonnegative(value: number): number {
  return Math.max(0, Math.trunc(value));
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : fallback;
}
