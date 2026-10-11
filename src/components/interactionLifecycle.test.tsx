import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldAdjustButton } from "./HoldAdjustButton";
import { useGroupedNumericAdjustment } from "./useGroupedNumericAdjustment";
import { BattlefieldLandCount } from "./BattlefieldLandCount";
import { interactions } from "../domain/interactions";
import { magnificationDestination } from "./useLifeMagnification";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  interactions.end("discard");
  vi.useRealTimers();
});

describe("gesture lifetime", () => {
  for (const termination of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "blur",
    "pagehide",
    "modal",
    "discard",
    "unmount",
  ]) {
    it(`stops repetition on ${termination}`, () => {
      const step = vi.fn();
      const view = render(
        <HoldAdjustButton label="Adjust" step={1} onStep={step}>
          +
        </HoldAdjustButton>,
      );
      const button = screen.getByRole("button");
      fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
      act(() => vi.advanceTimersByTime(800));
      expect(step.mock.calls.length).toBeGreaterThan(1);
      act(() => {
        if (termination === "unmount") view.unmount();
        else if (termination === "modal") interactions.end();
        else if (termination === "discard") interactions.end("discard");
        else if (termination === "pointerup")
          fireEvent.pointerUp(window, { pointerId: 1 });
        else if (termination === "pointercancel")
          fireEvent.pointerCancel(window, { pointerId: 1 });
        else if (termination === "lostpointercapture")
          fireEvent.lostPointerCapture(button, { pointerId: 1 });
        else fireEvent(window, new Event(termination));
      });
      const count = step.mock.calls.length;
      act(() => vi.advanceTimersByTime(3000));
      expect(step).toHaveBeenCalledTimes(count);
    });
  }
  it("reversal cancels the original owner and has exactly one repeater", () => {
    const minus = vi.fn(),
      plus = vi.fn();
    render(
      <>
        <HoldAdjustButton label="Minus" step={-1} onStep={minus}>
          -
        </HoldAdjustButton>
        <HoldAdjustButton label="Plus" step={1} onStep={plus}>
          +
        </HoldAdjustButton>
      </>,
    );
    fireEvent.pointerDown(screen.getByLabelText("Minus"));
    act(() => vi.advanceTimersByTime(500));
    const count = minus.mock.calls.length;
    fireEvent.pointerDown(screen.getByLabelText("Plus"));
    act(() => vi.advanceTimersByTime(1000));
    expect(minus).toHaveBeenCalledTimes(count);
    expect(plus.mock.calls.length).toBeGreaterThan(1);
    fireEvent.pointerUp(screen.getByLabelText("Plus"));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("discards an unfinished adjustment on New Game, including cleanup", () => {
    const commit = vi.fn();
    function Harness() {
      const adjustment = useGroupedNumericAdjustment({
        value: 40,
        onCommit: commit,
      });
      return (
        <HoldAdjustButton label="Minus" step={-1} onStep={adjustment.adjust}>
          -
        </HoldAdjustButton>
      );
    }
    const view = render(<Harness />);
    fireEvent.pointerDown(screen.getByLabelText("Minus"));
    act(() => vi.advanceTimersByTime(500));
    act(() => interactions.end("discard"));
    view.unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(commit).not.toHaveBeenCalled();
  });
  it("peeks only for the press lifetime and has an accessible breakdown", () => {
    render(<BattlefieldLandCount />);
    const button = screen.getByRole("button", {
      name: /Battlefield lands.*Basic.*Nonbasic/,
    });
    fireEvent.pointerDown(button);
    expect(button.querySelector(".land-breakdown")).not.toBeEmptyDOMElement();
    fireEvent.pointerCancel(button);
    expect(button.querySelector(".land-breakdown")).toBeEmptyDOMElement();
    fireEvent.keyDown(button, { key: " " });
    act(() => interactions.end());
    expect(button.querySelector(".land-breakdown")).toBeEmptyDOMElement();
  });
  it("requires magnification intent and springs back below threshold", () => {
    expect(magnificationDestination(1.25, false)).toBe(true);
    expect(magnificationDestination(1.1, false)).toBe(false);
    expect(magnificationDestination(0.75, true)).toBe(false);
    expect(magnificationDestination(0.9, true)).toBe(true);
  });
});
