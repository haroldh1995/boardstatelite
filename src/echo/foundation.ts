import { calculateTotals } from "../domain/field";
import type { FieldState, PermanentGroup } from "../domain/types";
import { createLiteFieldSnapshot } from "../rulesAdapter";
import { localParticipantId } from "../sharedSession";
import { serializeStable } from "../utils/stableSerialization";
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
  return Object.fromEntries(
    ECHO_CAPABILITIES.map((capability) => [capability, false]),
  ) as EchoCapabilityMap;
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
    const context: EchoAmbientContext = {
      version: ECHO_FOUNDATION_VERSION,
      compatibilityVersion: ECHO_COMPATIBILITY_VERSION,
      createdAt,
      fieldId: field.id,
      sessionId: field.session.id,
      localParticipantId: localParticipantId(field.session),
      currentMode: "simple",
      authority: "local-lite",
      status: "dormant",
      capabilities: this.getCapabilities(),
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
    return {
      status: "dormant",
      compatibilityVersion: ECHO_COMPATIBILITY_VERSION,
      capabilities: this.getCapabilities(),
      currentMode: "simple",
      authority: "local-lite",
      localOnly: true,
      userFacingEchoEnabled: false,
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
