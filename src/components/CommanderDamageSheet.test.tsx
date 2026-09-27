import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultField } from "../domain/field";
import { useFieldStore } from "../state/useFieldStore";
import { CommanderDamageSheet } from "./CommanderDamageSheet";

describe("Commander Damage direct adjustment", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useFieldStore.setState({
      field: createDefaultField(),
      hydrated: true,
      startupVisible: false,
      modal: null,
      lastResult: null,
      undoStack: [],
      redoStack: [],
    });
    useFieldStore.getState().addCommanderDamageSource("Alex", "Partner One");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("groups repeated commander damage and life into one combat transaction", () => {
    render(<CommanderDamageSheet />);
    const increase = screen.getByRole("button", {
      name: "Increase damage from Partner One",
    });
    for (let index = 0; index < 5; index += 1) {
      fireEvent.pointerDown(increase, { pointerId: index + 1 });
      fireEvent.pointerUp(increase, { pointerId: index + 1 });
    }
    expect(screen.getByText("+5")).toBeVisible();
    act(() => vi.advanceTimersByTime(650));
    const state = useFieldStore.getState();
    expect(state.field.commanderDamage.entries[0]?.damage).toBe(5);
    expect(state.field.player.life).toBe(35);
    state.undo();
    expect(
      useFieldStore.getState().field.commanderDamage.entries[0]?.damage,
    ).toBe(0);
    expect(useFieldStore.getState().field.player.life).toBe(40);
  });
});
