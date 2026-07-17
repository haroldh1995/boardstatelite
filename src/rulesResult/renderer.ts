import {
  createGenericGroup,
  createTokenGroup,
  makeId,
  mergeCompatibleStacks,
  recalculateStats,
  withStackKey,
} from "../domain/cards";
import { normalizeField } from "../domain/field";
import type {
  FieldState,
  PermanentGroup,
  ResolutionResult,
} from "../domain/types";
import type { BoardStateRulesEvaluation } from "../rulesAdapter/types";
import { createObjectResolver } from "./objectResolver";
import {
  canonicalizeBoardStateEvaluation,
  canonicalizeLiteHelperResult,
} from "./conversion";
import { validateRulesResult } from "./validation";
import {
  RULES_RESULT_RENDERER_VERSION,
  type CanonicalRulesResult,
  type RulesRenderOptions,
  type RulesRenderOutput,
  type RulesRendererDiagnostics,
  type RulesResultAnimation,
  type RulesResultChange,
  type RulesResultNotification,
  type RulesResultValidation,
  type RulesRenderingMode,
} from "./types";

const DEFAULT_DIAGNOSTICS: RulesRendererDiagnostics = {
  rendererVersion: RULES_RESULT_RENDERER_VERSION,
  renderingSource: "lite-helper",
  authoritySource: "local-lite",
  validationStatus: "valid",
  renderingDurationMs: 0,
  animationMode: "animated",
  replayCompatible: false,
  lastRenderedAt: new Date(0).toISOString(),
  warnings: [],
  lastError: null,
};

export class RulesResultRenderer {
  private diagnostics: RulesRendererDiagnostics = DEFAULT_DIAGNOSTICS;

  renderLiteHelperResult(
    before: FieldState,
    helperResult: ResolutionResult,
    options: RulesRenderOptions = {},
  ): RulesRenderOutput {
    const canonical = canonicalizeLiteHelperResult(
      before,
      helperResult,
      options.timestamp,
    );
    return this.renderCanonical(before, canonical, options);
  }

  renderAuthoritativeResult(
    before: FieldState,
    evaluation: BoardStateRulesEvaluation,
    options: RulesRenderOptions = {},
  ): RulesRenderOutput {
    const canonical = canonicalizeBoardStateEvaluation(
      before,
      evaluation,
      options.timestamp,
    );
    return this.renderCanonical(before, canonical, options);
  }

  renderCanonical(
    before: FieldState,
    canonical: CanonicalRulesResult,
    options: RulesRenderOptions = {},
  ): RulesRenderOutput {
    const started = performanceNow();
    const mode = renderingModeFor(before, options);
    const validation = validateRulesResult(before, canonical);
    const effectiveValidation =
      validation.status === "invalid"
        ? recoverValidation(validation)
        : validation;
    const renderedField =
      validation.status === "invalid"
        ? before
        : (canonical.finalField ?? applyChanges(before, canonical.changes));
    const notifications = notificationsFor(canonical, validation);
    const accessibilityAnnouncements = announcementsFor(canonical, validation);
    const animationQueue =
      options.silent || validation.status === "invalid"
        ? []
        : animationsFor(canonical, mode);
    const result = decorateResolutionResult(
      canonical,
      renderedField,
      effectiveValidation,
      mode,
      accessibilityAnnouncements,
    );
    const duration = performanceNow() - started;

    this.diagnostics = {
      rendererVersion: RULES_RESULT_RENDERER_VERSION,
      renderingSource: canonical.source,
      authoritySource: canonical.authority.sessionAuthority,
      validationStatus: effectiveValidation.status,
      renderingDurationMs: duration,
      animationMode: mode,
      replayCompatible: canonical.replayMarkers.length > 0,
      lastRenderedAt: canonical.createdAt,
      warnings: [...canonical.warnings, ...effectiveValidation.warnings],
      lastError:
        validation.status === "invalid" ? validation.errors.join(" ") : null,
    };

    return {
      result,
      canonical,
      validation: effectiveValidation,
      animationQueue,
      notifications,
      accessibilityAnnouncements,
      diagnostics: this.getDiagnostics(),
    };
  }

  getDiagnostics(): RulesRendererDiagnostics {
    return {
      ...this.diagnostics,
      warnings: [...this.diagnostics.warnings],
    };
  }
}

export const rulesResultRenderer = new RulesResultRenderer();

installRulesRendererDiagnosticsGlobal();

function applyChanges(
  before: FieldState,
  changes: RulesResultChange[],
): FieldState {
  let working = structuredClone(before);
  const resolver = () => createObjectResolver(working);

  for (const change of changes) {
    if (change.kind === "life" && change.player === "you") {
      working = {
        ...working,
        player: {
          ...working.player,
          life:
            change.nextValue ??
            Math.max(
              0,
              working.player.life +
                (change.mode === "gain" ? change.amount : -change.amount),
            ),
        },
      };
    }

    if (change.kind === "player-counter") {
      const current = working.player.counters[change.counter];
      if (typeof current === "number") {
        const next =
          change.mode === "set"
            ? change.amount
            : current +
              (change.mode === "add" ? change.amount : -change.amount);
        working = {
          ...working,
          player: {
            ...working.player,
            counters: {
              ...working.player.counters,
              [change.counter]: Math.max(0, next),
            },
          },
        };
      }
    }

    if (change.kind === "counter") {
      const resolved = resolver().resolve(change.target);
      if (!resolved) continue;
      working = updateGroup(working, resolved.groupId, (group) => {
        const current = group.counters[change.counter] ?? 0;
        const next =
          change.mode === "set"
            ? change.amount
            : current +
              (change.mode === "add" ? change.amount : -change.amount);
        return withStackKey(
          recalculateStats({
            ...group,
            counters: {
              ...group.counters,
              [change.counter]: Math.max(0, next),
            },
          }),
        );
      });
    }

    if (change.kind === "token" && change.mode === "created") {
      working = {
        ...working,
        groups: [
          ...working.groups,
          createTokenGroup({
            name: change.name,
            quantity: change.quantity,
            power: change.power ?? 1,
            toughness: change.toughness ?? 1,
            subtypes: change.subtypes ?? [change.name],
            colors: change.colors,
            tapped: change.tapped,
            attacking: change.attacking,
          }),
        ],
      };
    }

    if (
      (change.kind === "token" && change.mode === "removed") ||
      (change.kind === "permanent" && change.mode === "removed")
    ) {
      const target = change.target ? resolver().resolve(change.target) : null;
      if (!target) continue;
      working = removeQuantity(working, target.groupId, change.quantity);
    }

    if (change.kind === "permanent" && change.mode === "created") {
      working = {
        ...working,
        groups: [
          ...working.groups,
          createGenericGroup({
            kind: "Custom",
            label: change.label,
            quantity: change.quantity,
            zone: change.zone ?? "battlefield",
          }),
        ],
      };
    }

    if (change.kind === "zone") {
      const resolved = resolver().resolve(change.target);
      if (!resolved) continue;
      working = updateGroup(working, resolved.groupId, (group) =>
        withStackKey(recalculateStats({ ...group, zone: change.to })),
      );
    }

    if (change.kind === "attachment") {
      const attachment = resolver().resolve(change.attachment);
      const host = change.host ? resolver().resolve(change.host) : null;
      if (!attachment) continue;
      working = updateGroup(working, attachment.groupId, (group) =>
        withStackKey({ ...group, attachedTo: host?.groupId ?? null }),
      );
      if (host) {
        working = updateGroup(working, host.groupId, (group) =>
          withStackKey({
            ...group,
            attachments:
              change.mode === "attached"
                ? [...new Set([...group.attachments, attachment.groupId])]
                : group.attachments.filter((id) => id !== attachment.groupId),
          }),
        );
      }
    }

    if (change.kind === "status") {
      const resolved = resolver().resolve(change.target);
      if (!resolved) continue;
      working = updateGroup(working, resolved.groupId, (group) =>
        withStackKey(
          recalculateStats({
            ...group,
            statuses: { ...group.statuses, [change.status]: change.value },
          }),
        ),
      );
    }

    if (change.kind === "transform") {
      const resolved = resolver().resolve(change.target);
      if (!resolved) continue;
      working = updateGroup(working, resolved.groupId, (group) =>
        withStackKey({
          ...group,
          label: change.label ?? group.label,
          statuses: { ...group.statuses, transformed: change.transformed },
        }),
      );
    }

    if (change.kind === "depower") {
      const resolved = resolver().resolve(change.target);
      if (!resolved) continue;
      working = updateGroup(working, resolved.groupId, (group) =>
        withStackKey({
          ...group,
          abilitiesActive: change.mode === "none",
          depowerMode: change.mode,
          statuses: {
            ...group.statuses,
            depowered: change.mode !== "none",
          },
        }),
      );
    }

    if (change.kind === "tracking") {
      const resolved = resolver().resolve(change.target);
      if (!resolved) continue;
      working = updateGroup(working, resolved.groupId, (group) =>
        withStackKey({ ...group, trackingEnabled: change.trackingEnabled }),
      );
    }

    if (change.kind === "power-toughness") {
      const resolved = resolver().resolve(change.target);
      if (!resolved) continue;
      working = updateGroup(working, resolved.groupId, (group) =>
        withStackKey(
          recalculateStats({
            ...group,
            pt: {
              ...group.pt,
              basePower: change.basePower ?? group.pt.basePower,
              baseToughness: change.baseToughness ?? group.pt.baseToughness,
              currentPower: change.currentPower ?? group.pt.currentPower,
              currentToughness:
                change.currentToughness ?? group.pt.currentToughness,
            },
          }),
        ),
      );
    }
  }

  return normalizeField({
    ...working,
    groups: mergeCompatibleStacks(working.groups),
  });
}

function updateGroup(
  field: FieldState,
  groupId: string,
  updater: (group: PermanentGroup) => PermanentGroup,
): FieldState {
  return {
    ...field,
    groups: field.groups.map((group) =>
      group.id === groupId ? updater(group) : group,
    ),
  };
}

function removeQuantity(
  field: FieldState,
  groupId: string,
  quantity: number,
): FieldState {
  return {
    ...field,
    groups: field.groups
      .map((group) =>
        group.id === groupId
          ? { ...group, quantity: group.quantity - quantity }
          : group,
      )
      .filter((group) => group.quantity > 0),
  };
}

function decorateResolutionResult(
  canonical: CanonicalRulesResult,
  field: FieldState,
  validation: RulesResultValidation,
  mode: RulesRenderingMode,
  announcements: string[],
): ResolutionResult {
  const summary =
    validation.status !== "valid"
      ? ["The rules result could not be applied safely. Battlefield unchanged."]
      : canonical.summary;
  return {
    field,
    title:
      validation.status !== "valid"
        ? "Rules Result Not Applied"
        : canonical.title,
    summary,
    details:
      validation.status !== "valid"
        ? [
            ...canonical.details,
            {
              id: makeId("step"),
              label: "Rules result validation failed",
              detail: validation.errors.join(" "),
            },
          ]
        : canonical.details,
    events: canonical.events,
    changedGroupIds: canonical.changedGroupIds,
    loopDetected: canonical.loopDetected,
    rendering: {
      source: canonical.source,
      authorityLabel: canonical.authority.label,
      rulesVersion: canonical.authority.rulesVersion,
      validationStatus: validation.status,
      animationMode: mode,
      warnings: [...canonical.warnings, ...validation.warnings],
      unsupportedInteractions: [...canonical.unsupportedInteractions],
      judgeNotes: [...canonical.judgeNotes],
      replayMarkers: [...canonical.replayMarkers],
    },
    accessibilityAnnouncements: announcements,
  };
}

function renderingModeFor(
  field: FieldState,
  options: RulesRenderOptions,
): RulesRenderingMode {
  if (options.silent) return "silent";
  if (options.mode) return options.mode;
  if (
    field.settings.reducedMotion ||
    field.settings.animationSpeed === "reduced"
  ) {
    return "reduced-motion";
  }
  return "animated";
}

function recoverValidation(
  validation: RulesResultValidation,
): RulesResultValidation {
  return {
    ...validation,
    status: "recovered",
  };
}

function notificationsFor(
  canonical: CanonicalRulesResult,
  validation: RulesResultValidation,
): RulesResultNotification[] {
  const notifications: RulesResultNotification[] = [];
  for (const warning of [...canonical.warnings, ...validation.warnings]) {
    notifications.push({
      id: makeId("notice"),
      kind: "rules-warning",
      message: warning,
    });
  }
  for (const unsupported of canonical.unsupportedInteractions) {
    notifications.push({
      id: makeId("notice"),
      kind: "manual-resolution",
      message: unsupported,
    });
  }
  for (const note of canonical.judgeNotes) {
    notifications.push({
      id: makeId("notice"),
      kind: "judge-note",
      message: note,
    });
  }
  if (canonical.replayMarkers.length > 0) {
    notifications.push({
      id: makeId("notice"),
      kind: "replay-available",
      message: "Replay markers are available for this rules result.",
    });
  }
  return notifications;
}

function animationsFor(
  canonical: CanonicalRulesResult,
  mode: RulesRenderingMode,
): RulesResultAnimation[] {
  if (mode === "silent") return [];
  return canonical.changes.map((change) => ({
    id: makeId("animation"),
    kind: animationKind(change),
    groupIds: groupIdsForAnimation(change),
    label: labelForAnimation(change),
    mode,
  }));
}

function animationKind(
  change: RulesResultChange,
): RulesResultAnimation["kind"] {
  if (change.kind === "life") return "life";
  if (change.kind === "counter") return "counter";
  if (change.kind === "token") return "token";
  if (
    change.kind === "status" ||
    change.kind === "depower" ||
    change.kind === "tracking"
  ) {
    return "status";
  }
  if (change.kind === "transform") return "transform";
  if (change.kind === "zone") return "zone";
  if (change.kind === "attachment") return "attachment";
  return "highlight";
}

function groupIdsForAnimation(change: RulesResultChange): string[] {
  if ("target" in change && change.target?.groupId)
    return [change.target.groupId];
  if (change.kind === "attachment") {
    return [change.attachment.groupId, change.host?.groupId].filter(
      (entry): entry is string => Boolean(entry),
    );
  }
  return [];
}

function labelForAnimation(change: RulesResultChange): string {
  if (change.kind === "counter") return `${change.counter} ${change.mode}`;
  if (change.kind === "life") return `Life ${change.mode}`;
  if (change.kind === "token") return `${change.quantity} ${change.name}`;
  return change.kind;
}

function announcementsFor(
  canonical: CanonicalRulesResult,
  validation: RulesResultValidation,
): string[] {
  if (validation.status === "invalid") {
    return ["Rules result could not be applied safely."];
  }
  return [
    ...canonical.summary.slice(0, 3),
    ...canonical.warnings.slice(0, 2).map((warning) => `Warning: ${warning}`),
    ...canonical.unsupportedInteractions
      .slice(0, 1)
      .map((entry) => `Manual resolution required: ${entry}`),
  ];
}

function performanceNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function installRulesRendererDiagnosticsGlobal(): void {
  if (typeof globalThis === "undefined") return;
  const target = globalThis as typeof globalThis & {
    __BAORD_STATE_LITE_RULES_RENDERER__?: {
      getDiagnostics: () => RulesRendererDiagnostics;
    };
  };
  target.__BAORD_STATE_LITE_RULES_RENDERER__ = {
    getDiagnostics: () => rulesResultRenderer.getDiagnostics(),
  };
}
