import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HoldAdjustButton } from "./HoldAdjustButton";

describe("hold adjustment control", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("steps immediately, repeats after a hold delay, and stops on release", () => {
    vi.useFakeTimers();
    const onStep = vi.fn();
    render(
      <HoldAdjustButton label="Decrease" step={-1} onStep={onStep}>
        -
      </HoldAdjustButton>,
    );
    const button = screen.getByRole("button", { name: "Decrease" });
    fireEvent.pointerDown(button, { pointerId: 1 });
    expect(onStep).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(429));
    expect(onStep).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(116));
    expect(onStep).toHaveBeenCalledTimes(2);
    fireEvent.pointerUp(button, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(500));
    expect(onStep).toHaveBeenCalledTimes(2);
  });
});
