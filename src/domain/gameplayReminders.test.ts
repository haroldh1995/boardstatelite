import { describe, expect, it } from "vitest";
import { createDefaultField, normalizeField } from "./field";
import { deriveGameplayReminders } from "./gameplayReminders";
import { setConfirmedLandPlays } from "../echo/preTurnPlanner";

describe("gameplay reminders", () => {
  it("is off by default and surfaces one stable land reminder when enabled", () => {
    const field = createDefaultField();
    expect(deriveGameplayReminders(field)).toEqual([]);
    const enabled = normalizeField({
      ...field,
      settings: { ...field.settings, gameplayReminders: true },
      ambient: { ...field.ambient, currentMode: "activeTurn" },
    });
    const reminders = deriveGameplayReminders(enabled);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      kind: "land-play",
      message: "Land play not marked yet.",
      action: "open-land-play",
    });
    expect(deriveGameplayReminders(enabled)[0].id).toBe(reminders[0].id);
  });

  it("clears the land reminder once the turn marker is complete", () => {
    const field = createDefaultField();
    const planner = setConfirmedLandPlays(field.preTurnPlanner, 1);
    const enabled = normalizeField({
      ...field,
      settings: { ...field.settings, gameplayReminders: true },
      ambient: { ...field.ambient, currentMode: "activeTurn" },
      preTurnPlanner: planner,
    });
    expect(deriveGameplayReminders(enabled)).toEqual([]);
  });

  it("preserves the reminder preference through field normalization", () => {
    const field = createDefaultField();
    const restored = normalizeField(
      structuredClone({
        ...field,
        settings: { ...field.settings, gameplayReminders: true },
      }),
    );

    expect(restored.settings.gameplayReminders).toBe(true);
  });
});
