import { calculateTotals } from "../domain/field";
import type { FieldState, PermanentGroup } from "../domain/types";
import { createLiteFieldSnapshot } from "../rulesAdapter";
import { localParticipantId } from "../sharedSession";
import { serializeStable } from "../utils/stableSerialization";
import { normalizeAmbientGameplayState } from "./ambientEngine";
import {
  ECHO_CAPABILITIES,
  ECHO_COMPATIBILITY_VERSION,
  ECHO_FOUNDATION_VERSION,
  type EchoAmbientContext,
  type EchoCapabilityMap,
  type EchoFoundationDiagnostics,
  type EchoPermanentContext,
} from "./types";

export function createDormantEchoCapabilities(): EchoCapabilityMap {
  const capabilities = Object.fromEntries(
    ECHO_CAPABILITIES.map((capability) => [capability, false]),
  ) as EchoCapabilityMap;
  return {
    ...capabilities,
    ambientGameplayEngine: true,
    passiveMode: true,
    preTurnPreparationMode: true,
    activeTurnMode: true,
    recoveryMode: true,
    combatMode: true,
    resolutionMode: true,
    postTurnMode: true,
    turnPlanner: true,
    actionPipeline: true,
    voiceServices: true,
    speakerVerification: true,
    magicCommandGrammar: true,
  };
}

export class EchoFoundationManager {
  private lastContextAt: string | null = null;
  private lastFieldId: string | null = null;
  private capabilities = createDormantEchoCapabilities();

  createAmbientContext(
    field: FieldState,
    options: { timestamp?: string } = {},
  ): EchoAmbientContext {
    const createdAt = options.timestamp ?? new Date().toISOString();
    const ambient = normalizeAmbientGameplayState(field.ambient, {
      fallbackTimestamp: field.updatedAt,
      sessionId: field.session.id,
    });
    const context: EchoAmbientContext = {
      version: ECHO_FOUNDATION_VERSION,
      compatibilityVersion: ECHO_COMPATIBILITY_VERSION,
      createdAt,
      fieldId: field.id,
      sessionId: field.session.id,
      localParticipantId: localParticipantId(field.session),
      currentMode: "simple",
      authority: "local-lite",
      status: "architecture-ready",
      capabilities: this.getCapabilities(),
      ambient,
      player: structuredClone(field.player),
      relevantTotals: calculateTotals(field.groups),
      battlefield: field.groups
        .slice()
        .sort((left, right) => left.order - right.order)
        .map(createPermanentContext),
      liteSnapshot: createLiteFieldSnapshot(field),
      boundaries: {
        authoritativeRulesAvailable: false,
        hubAvailable: false,
        networkingAvailable: false,
        userFacingEchoEnabled: false,
      },
    };
    this.lastContextAt = createdAt;
    this.lastFieldId = field.id;
    return context;
  }

  serializeAmbientContext(context: EchoAmbientContext): string {
    return serializeStable(context);
  }

  getCapabilities(): EchoCapabilityMap {
    return { ...this.capabilities };
  }

  diagnostics(field?: FieldState): EchoFoundationDiagnostics {
    const ambient = field
      ? normalizeAmbientGameplayState(field.ambient, {
          fallbackTimestamp: field.updatedAt,
          sessionId: field.session.id,
        })
      : null;
    return {
      status: "architecture-ready",
      compatibilityVersion: ECHO_COMPATIBILITY_VERSION,
      capabilities: this.getCapabilities(),
      currentMode: "simple",
      authority: "local-lite",
      localOnly: true,
      userFacingEchoEnabled: false,
      ambientMode: ambient?.currentMode ?? "passive",
      lastContextAt: this.lastContextAt,
      lastFieldId: field?.id ?? this.lastFieldId,
    };
  }
}

export const echoFoundationManager = new EchoFoundationManager();

function createPermanentContext(group: PermanentGroup): EchoPermanentContext {
  return {
    groupId: group.id,
    objectIds: [...(group.session?.objectIds ?? [group.id])],
    label: group.label,
    zone: group.zone,
    quantity: group.quantity,
    cardTypes: [...group.characteristics.cardTypes].sort(),
    subtypes: [...group.characteristics.subtypes].sort(),
    counters: Object.fromEntries(
      Object.entries(group.counters).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    statuses: { ...group.statuses },
    trackingEnabled: group.trackingEnabled !== false,
    abilitiesActive: group.abilitiesActive,
    depowerMode: group.depowerMode,
    isGeneric: group.isGeneric,
    isToken: group.characteristics.isToken,
    currentPower: group.pt.currentPower,
    currentToughness: group.pt.currentToughness,
  };
}
