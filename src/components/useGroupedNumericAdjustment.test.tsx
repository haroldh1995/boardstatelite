import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGroupedNumericAdjustment } from "./useGroupedNumericAdjustment";

describe("grouped numeric adjustment", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("groups rapid taps, displays a cumulative net delta, and commits once", () => {
    vi.useFakeTimers();
    const commits: number[] = [];
    function Harness() {
      const [value, setValue] = useState(40);
      const adjustment = useGroupedNumericAdjustment({
        value,
        minimum: 0,
        inactivityMs: 500,
        retainMs: 700,
        onCommit: (delta) => {
          commits.push(delta);
          setValue((current) => current + delta);
        },
      });
      return (
        <>
          <output aria-label="value">{adjustment.displayedValue}</output>
          <output aria-label="delta">{adjustment.displayedDelta}</output>
          <button type="button" onClick={() => adjustment.adjust(-1)}>
            Minus
          </button>
          <button type="button" onClick={() => adjustment.adjust(1)}>
            Plus
          </button>
        </>
      );
    }
    render(<Harness />);
    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Minus" }));
    }
    expect(screen.getByLabelText("value")).toHaveTextContent("35");
    expect(screen.getByLabelText("delta")).toHaveTextContent("-5");
    fireEvent.click(screen.getByRole("button", { name: "Plus" }));
    fireEvent.click(screen.getByRole("button", { name: "Plus" }));
    expect(screen.getByLabelText("value")).toHaveTextContent("37");
    expect(screen.getByLabelText("delta")).toHaveTextContent("-3");
    expect(commits).toEqual([]);

    act(() => vi.advanceTimersByTime(500));
    expect(commits).toEqual([-3]);
    expect(screen.getByLabelText("value")).toHaveTextContent("37");
    expect(screen.getByLabelText("delta")).toHaveTextContent("-3");
    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByLabelText("delta")).toHaveTextContent("0");
  });

  it("bounds a grouped transaction at zero", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    function Harness() {
      const adjustment = useGroupedNumericAdjustment({
        value: 2,
        minimum: 0,
        inactivityMs: 100,
        onCommit,
      });
      return (
        <button type="button" onClick={() => adjustment.adjust(-5)}>
          {adjustment.displayedValue}
        </button>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("0");
    act(() => vi.advanceTimersByTime(100));
    expect(onCommit).toHaveBeenCalledWith(-2);
  });
});
