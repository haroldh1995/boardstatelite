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
import { FullScreenLife } from "./FullScreenLife";

describe("Full-Screen Life transactions", () => {
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
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("matches the normal tracker's cumulative one-transaction behavior", () => {
    render(<FullScreenLife />);
    const decrease = screen.getByRole("button", {
      name: "Lose life. Press and hold for continuous adjustment.",
    });
    for (let index = 0; index < 5; index += 1) {
      fireEvent.pointerDown(decrease, { pointerId: index + 1 });
      fireEvent.pointerUp(decrease, { pointerId: index + 1 });
    }
    const surface = screen.getByRole("main", { name: "Full-screen life mode" });
    expect(
      surface.querySelector(".full-life-center > strong"),
    ).toHaveTextContent("35");
    expect(screen.getByText("-5")).toBeVisible();
    act(() => vi.advanceTimersByTime(650));
    expect(useFieldStore.getState().field.player.life).toBe(35);
    expect(useFieldStore.getState().undoStack).toHaveLength(1);
    useFieldStore.getState().undo();
    expect(useFieldStore.getState().field.player.life).toBe(40);
  });
});
