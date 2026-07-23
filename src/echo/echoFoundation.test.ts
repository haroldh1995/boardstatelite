import { describe, expect, it } from "vitest";
import { activateField } from "../domain/engine";
import { createDefaultField, normalizeField } from "../domain/field";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  tracked,
} from "../test/factories";
import {
  ECHO_CAPABILITIES,
  EchoFoundationManager,
  createDormantEchoCapabilities,
} from "./index";

describe("Echo ambient foundation", () => {
  it("creates an architecture-ready local-only context without enabling user-facing Echo features", () => {
    const field = createDefaultField();
    const manager = new EchoFoundationManager();
    const before = structuredClone(field);

    const context = manager.createAmbientContext(field, {
      timestamp: "2026-07-20T00:00:00.000Z",
    });

    expect(field).toEqual(before);
    expect(context.status).toBe("architecture-ready");
    expect(context.currentMode).toBe("simple");
    expect(context.authority).toBe("local-lite");
    expect(context.ambient.currentMode).toBe("passive");
    expect(context.boundaries).toEqual({
      authoritativeRulesAvailable: false,
      hubAvailable: false,
      networkingAvailable: false,
      userFacingEchoEnabled: false,
    });
    expect(context.capabilities.ambientGameplayEngine).toBe(true);
    expect(context.capabilities.voiceServices).toBe(true);
    expect(context.capabilities.speakerVerification).toBe(true);
    expect(context.capabilities.aiRecommendations).toBe(false);
    expect(context.liteSnapshot.metadata.fieldId).toBe(field.id);
    expect(context.sessionId).toBe(field.session.id);
  });

  it("keeps the capability contract complete and limits enabled items to architecture only", () => {
    const capabilities = createDormantEchoCapabilities();

    expect(Object.keys(capabilities).sort()).toEqual(
      [...ECHO_CAPABILITIES].sort(),
    );
    expect(capabilities).toMatchObject({
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
      combatPrediction: false,
    });
  });

  it("serializes ambient contexts deterministically by reusing existing snapshots", () => {
    const field = normalizeField(
      fieldWith([tracked(animPakal()), tracked(catharsCrusade())]),
    );
    const manager = new EchoFoundationManager();
    const first = manager.createAmbientContext(field, {
      timestamp: "2026-07-20T00:00:00.000Z",
    });
    const second = manager.createAmbientContext(field, {
      timestamp: "2026-07-20T00:00:00.000Z",
    });

    expect(manager.serializeAmbientContext(first)).toBe(
      manager.serializeAmbientContext(second),
    );
    expect(first.relevantTotals.creatures).toBe(1);
    expect(first.relevantTotals.enchantments).toBe(1);
    expect(first.battlefield).toHaveLength(2);
  });

  it("does not alter the Lite helper engine or Activate Field result path", () => {
    const field = normalizeField(
      fieldWith([tracked(animPakal()), tracked(catharsCrusade())]),
    );
    const manager = new EchoFoundationManager();

    manager.createAmbientContext(field, {
      timestamp: "2026-07-20T00:00:00.000Z",
    });
    const result = activateField(field);

    expect(result.title).toBe("Field Activated");
    expect(result.summary.join(" ")).toContain("Anim Pakal");
    expect(result.summary.join(" ")).toContain("Cathars' Crusade");
    expect(manager.diagnostics(field)).toMatchObject({
      status: "architecture-ready",
      authority: "local-lite",
      localOnly: true,
      userFacingEchoEnabled: false,
      ambientMode: "passive",
      lastFieldId: field.id,
    });
  });
});
