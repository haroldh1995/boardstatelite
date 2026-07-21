import { describe, expect, it } from "vitest";
import { setLife as resolveSetLife } from "../domain/engine";
import { createDefaultField } from "../domain/field";
import {
  AmbientEventPipeline,
  createAmbientIntent,
  createAmbientPreview,
  validateAmbientContext,
  validateAmbientRules,
} from "./ambientEventPipeline";
import {
  AmbientConfidenceDecisionEngine,
  createAmbientCorrectionRequest,
  decideAmbientApprovalWithConfidence,
  isAmbientPreviewExpired,
  normalizeAmbientConfidence,
  routeAmbientCorrection,
  transitionAmbientPreview,
} from "./ambientConfidence";

const timestamp = "2026-07-20T00:00:00.000Z";

function decisionInput(
  confidence: ReturnType<typeof normalizeAmbientConfidence>,
  overrides: Partial<
    Parameters<AmbientConfidenceDecisionEngine["decide"]>[0]
  > = {},
): Parameters<AmbientConfidenceDecisionEngine["decide"]>[0] {
  return {
    confidence,
    mode: "passive",
    intentKind: "modify-life",
    source: "manual",
    contextValidation: { ok: true, errors: [], warnings: [], mode: "passive" },
    ruleValidation: { ok: true, errors: [], warnings: [] },
    entityResolutionOk: true,
    requiresPreview: false,
    timestamp,
    ...overrides,
  };
}

describe("Ambient Confidence, Confirmation, and Recovery Framework", () => {
  it("normalizes structured confidence assessments for every supported level", () => {
    expect(
      normalizeAmbientConfidence("high", {
        source: "manual",
        timestamp,
        contextValid: true,
        rulesValid: true,
        warningCount: 0,
      }),
    ).toMatchObject({ level: "high", score: 0.95 });
    expect(
      normalizeAmbientConfidence("medium", {
        source: "turn-planner",
        timestamp,
      }),
    ).toMatchObject({ level: "medium", source: "turn-planner", score: 0.65 });
    expect(
      normalizeAmbientConfidence("low", {
        source: "user-correction",
        timestamp,
      }),
    ).toMatchObject({ level: "low", score: 0.25 });
    expect(
      normalizeAmbientConfidence(undefined, {
        source: "system",
        timestamp,
      }),
    ).toMatchObject({ level: "unknown", score: null });
  });

  it("routes confidence decisions through one reusable execution engine", () => {
    const engine = new AmbientConfidenceDecisionEngine();
    const high = normalizeAmbientConfidence("high", {
      source: "manual",
      timestamp,
      contextValid: true,
      rulesValid: true,
    });
    const medium = normalizeAmbientConfidence("medium", {
      source: "manual",
      timestamp,
      contextValid: true,
      rulesValid: true,
    });
    const low = normalizeAmbientConfidence("low", {
      source: "manual",
      timestamp,
      contextValid: true,
      rulesValid: true,
    });
    const unknown = normalizeAmbientConfidence(undefined, {
      source: "manual",
      timestamp,
      contextValid: true,
      rulesValid: true,
    });

    expect(engine.decide(decisionInput(high)).path).toBe("immediate-execution");
    expect(engine.decide(decisionInput(medium)).path).toBe(
      "preview-before-commit",
    );
    expect(engine.decide(decisionInput(low)).path).toBe("correction-workflow");
    expect(engine.decide(decisionInput(unknown)).path).toBe("action-rejection");
    expect(
      engine.decide(
        decisionInput(high, {
          contextValidation: {
            ok: false,
            errors: ["Focused mode was interrupted."],
            warnings: [],
            mode: "passive",
          },
        }),
      ).path,
    ).toBe("recovery-mode");
    expect(
      engine.decide(
        decisionInput(high, {
          ruleValidation: {
            ok: false,
            errors: ["Payload value amount cannot be negative."],
            warnings: [],
          },
        }),
      ).path,
    ).toBe("action-rejection");
  });

  it("keeps previews isolated across lifecycle transitions", () => {
    const field = createDefaultField();
    const intent = createAmbientIntent({
      id: "preview-lifecycle",
      kind: "create-token",
      source: "turn-planner",
      confidence: "medium",
      requiresPreview: true,
    });
    const preview = createAmbientPreview({
      field,
      intent,
      resolvedEntities: [],
      timestamp,
    });
    const updated = transitionAmbientPreview(preview, "updated", {
      timestamp: "2026-07-20T00:00:01.000Z",
      reason: "Preview changed.",
    });
    const approved = transitionAmbientPreview(updated, "approved", {
      timestamp: "2026-07-20T00:00:02.000Z",
      reason: "User approved.",
    });
    const committed = transitionAmbientPreview(approved, "committed", {
      timestamp: "2026-07-20T00:00:03.000Z",
      reason: "Mutation committed.",
    });

    expect(preview.status).toBe("created");
    expect(updated.status).toBe("updated");
    expect(approved.status).toBe("approved");
    expect(committed).toMatchObject({
      status: "committed",
      lifecycle: [
        { status: "created" },
        { status: "updated" },
        { status: "approved" },
        { status: "committed" },
      ],
    });
    expect(preview.lifecycle).toHaveLength(1);
  });

  it("detects expired previews and routes approvals without committing early", () => {
    const field = createDefaultField();
    const intent = createAmbientIntent({
      id: "expired-preview",
      kind: "create-token",
      source: "turn-planner",
      confidence: "medium",
      requiresPreview: true,
    });
    const preview = {
      ...createAmbientPreview({
        field,
        intent,
        resolvedEntities: [],
        timestamp,
      }),
      expiresAt: "2026-07-20T00:00:01.000Z",
    };
    const decision = new AmbientConfidenceDecisionEngine().decide(
      decisionInput(intent.confidence, { requiresPreview: true }),
    );

    expect(isAmbientPreviewExpired(preview, "2026-07-20T00:00:02.000Z")).toBe(
      true,
    );
    expect(
      decideAmbientApprovalWithConfidence({
        decision,
        approval: { method: "manual" },
        hasPreview: true,
        previewExpired: true,
      }),
    ).toBe("recovery-required");
    expect(
      decideAmbientApprovalWithConfidence({
        decision,
        approval: { method: "automatic" },
        hasPreview: true,
        previewExpired: false,
      }),
    ).toBe("approved");
  });

  it("creates correction requests for low-confidence actions", () => {
    const confidence = normalizeAmbientConfidence("low", {
      source: "voice-command",
      timestamp,
      contextValid: true,
      rulesValid: true,
    });
    const decision = new AmbientConfidenceDecisionEngine().decide(
      decisionInput(confidence),
    );
    const correction = routeAmbientCorrection({
      decision,
      intentId: "intent-low",
      timestamp,
    });
    const explicit = createAmbientCorrectionRequest({
      type: "wrong-card",
      intentId: "intent-low",
      reason: "Wrong card selected.",
      timestamp,
    });

    expect(decision.path).toBe("correction-workflow");
    expect(correction).toMatchObject({
      type: "retry",
      status: "pending",
      intentId: "intent-low",
    });
    expect(explicit).toMatchObject({ type: "wrong-card", status: "pending" });
  });

  it("rejects unknown confidence without mutation, undo, or history", () => {
    const pipeline = new AmbientEventPipeline();
    const field = createDefaultField();
    const result = pipeline.process({
      field,
      intent: {
        id: "unknown-confidence",
        kind: "modify-life",
        source: "manual",
        payload: { amount: 5 },
      },
      mutation: ({ field: current }) => resolveSetLife(current, 45, "gain"),
    });

    expect(result.status).toBe("rejected");
    expect(result.field.player.life).toBe(40);
    expect(result.historyEntry).toBeNull();
    expect(result.undo).toBeNull();
    expect(result.event?.result.status).toBe("rejected");
  });

  it("requires correction for low-confidence pipeline actions before mutation", () => {
    const pipeline = new AmbientEventPipeline();
    const field = createDefaultField();
    const result = pipeline.process({
      field,
      intent: {
        id: "low-confidence",
        kind: "modify-life",
        source: "manual",
        confidence: "low",
        payload: { amount: 5 },
      },
      mutation: ({ field: current }) => resolveSetLife(current, 45, "gain"),
    });

    expect(result.status).toBe("correction-required");
    expect(result.field.player.life).toBe(40);
    expect(result.correction).toMatchObject({ status: "pending" });
    expect(result.historyEntry).toBeNull();
  });

  it("previews medium-confidence pipeline actions without mutating battlefield state", () => {
    const pipeline = new AmbientEventPipeline();
    const field = createDefaultField();
    const result = pipeline.process({
      field,
      intent: {
        id: "medium-confidence-preview",
        kind: "modify-life",
        source: "manual",
        confidence: "medium",
        payload: { amount: 5 },
      },
      approval: { method: "manual" },
      mutation: ({ field: current }) => resolveSetLife(current, 45, "gain"),
    });

    expect(result.status).toBe("preview");
    if (result.status !== "preview") throw new Error("Expected preview.");
    expect(result.field.player.life).toBe(40);
    expect(result.preview.status).toBe("created");
    expect(result.undo).toBeNull();
  });

  it("commits approved previews through the canonical pipeline and existing undo data", () => {
    const pipeline = new AmbientEventPipeline();
    const field = createDefaultField();
    const result = pipeline.process({
      field,
      intent: {
        id: "approved-medium-confidence",
        kind: "modify-life",
        source: "manual",
        confidence: "medium",
        payload: { amount: 5 },
      },
      approval: { method: "automatic" },
      mutation: ({ field: current }) => resolveSetLife(current, 45, "gain"),
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Expected completion.");
    expect(result.field.player.life).toBe(45);
    expect(result.preview?.status).toBe("committed");
    expect(result.historyEntry.summary.join(" ")).toContain(
      "Life gain: 40 to 45",
    );
    expect(result.undo.before.player.life).toBe(40);
  });

  it("enters recovery mode for invalid context without corrupting battlefield state", () => {
    const pipeline = new AmbientEventPipeline();
    const field = createDefaultField();
    const result = pipeline.process({
      field,
      intent: {
        id: "invalid-context-recovery",
        kind: "attack",
        source: "manual",
        confidence: "high",
        requiredMode: "combat",
      },
      mutation: ({ field: current }) => ({
        ...current,
        player: { ...current.player, life: 1 },
      }),
    });

    expect(result.status).toBe("recovery-required");
    expect(result.field.player.life).toBe(40);
    expect(result.field.ambient.currentMode).toBe("recovery");
    expect(result.historyEntry).toBeNull();
  });

  it("keeps existing context and rule validation as the confidence framework inputs", () => {
    const field = createDefaultField();
    const intent = createAmbientIntent({
      id: "validation-inputs",
      kind: "modify-life",
      source: "manual",
      confidence: "high",
      payload: { amount: 1 },
    });
    const context = validateAmbientContext({
      field,
      intent,
      resolvedEntities: [],
    });
    const rules = validateAmbientRules({
      field,
      intent,
      resolvedEntities: [],
    });

    expect(context.ok).toBe(true);
    expect(rules.ok).toBe(true);
  });
});
